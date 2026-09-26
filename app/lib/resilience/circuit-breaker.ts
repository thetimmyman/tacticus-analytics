import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.resilience.circuit-breaker')

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export type StateChangeCallback = (
  circuitName: string,
  previousState: CircuitState,
  newState: CircuitState
) => void | Promise<void>

export interface CircuitBreakerConfig {
  name: string
  /** Consecutive failures that open the circuit. */
  failureThreshold: number
  /** HALF_OPEN successes that close the circuit. */
  successThreshold: number
  /** ms before OPEN moves to HALF_OPEN. */
  timeout: number
  fallback?: <T>() => Promise<T>
  registerInRegistry?: boolean
  onStateChange?: StateChangeCallback
}

export interface CircuitMetrics {
  name: string
  state: CircuitState
  failureCount: number
  successCount: number
  lastFailureTime: Date | null
  lastSuccessTime: Date | null
  lastStateChange: Date
  totalRequests: number
  totalFailures: number
  totalSuccesses: number
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly timeUntilHalfOpen: number
  ) {
    super(
      `Circuit "${circuitName}" is OPEN. Retry in ${Math.ceil(timeUntilHalfOpen / 1000)}s`
    )
    this.name = 'CircuitOpenError'
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private failureCount = 0
  private successCount = 0
  private lastFailureTime: Date | null = null
  private lastSuccessTime: Date | null = null
  private lastStateChange: Date = new Date()

  private totalRequests = 0
  private totalFailures = 0
  private totalSuccesses = 0

  constructor(private readonly config: CircuitBreakerConfig) {
    if (config.registerInRegistry !== false) {
      import('./registry').then(({ circuitRegistry }) => {
        circuitRegistry.register(this)
      })
    }

    logger.debug(
      {
        failureThreshold: config.failureThreshold,
        successThreshold: config.successThreshold,
        timeout: config.timeout
      },
      `Circuit breaker "${config.name}" initialized`
    )
  }

  get name(): string {
    return this.config.name
  }

  getState(): CircuitState {
    this.maybeEnterHalfOpen()
    return this.state
  }

  getMetrics(): CircuitMetrics {
    this.maybeEnterHalfOpen()
    return {
      name: this.config.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses
    }
  }

  /** Also runs on state reads: /api/health only reads, so an idle process would report a stale OPEN forever. */
  private maybeEnterHalfOpen(): void {
    if (this.state === 'OPEN' && this.shouldAttemptRecovery()) {
      this.transitionTo('HALF_OPEN')
    }
  }

  private shouldAttemptRecovery(): boolean {
    if (this.state !== 'OPEN' || !this.lastFailureTime) {
      return false
    }

    const timeSinceFailure = Date.now() - this.lastFailureTime.getTime()
    return timeSinceFailure >= this.config.timeout
  }

  private getTimeUntilHalfOpen(): number {
    if (this.state !== 'OPEN' || !this.lastFailureTime) {
      return 0
    }

    const timeSinceFailure = Date.now() - this.lastFailureTime.getTime()
    return Math.max(0, this.config.timeout - timeSinceFailure)
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return

    const previousState = this.state
    this.state = newState
    this.lastStateChange = new Date()

    logger.info(
      {
        failureCount: this.failureCount,
        successCount: this.successCount
      },
      `Circuit "${this.config.name}" transitioned: ${previousState} -> ${newState}`
    )

    if (newState === 'CLOSED') {
      this.failureCount = 0
      this.successCount = 0
    } else if (newState === 'HALF_OPEN') {
      this.successCount = 0
    }

    if (this.config.onStateChange) {
      Promise.resolve(
        this.config.onStateChange(this.config.name, previousState, newState)
      ).catch((err) => {
        logger.warn(
          { error: err },
          `Circuit "${this.config.name}" state change callback failed`
        )
      })
    }
  }

  private onSuccess(): void {
    this.totalSuccesses++
    this.lastSuccessTime = new Date()

    if (this.state === 'HALF_OPEN') {
      this.successCount++

      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('CLOSED')
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0
    }
  }

  private onFailure(): void {
    this.totalFailures++
    this.lastFailureTime = new Date()
    this.failureCount++

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN')
    } else if (this.state === 'CLOSED') {
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo('OPEN')
      }
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++

    this.maybeEnterHalfOpen()

    if (this.state === 'OPEN') {
      if (this.config.fallback) {
        logger.debug(`Circuit "${this.config.name}" is OPEN, using fallback`)
        return this.config.fallback<T>()
      }

      throw new CircuitOpenError(this.config.name, this.getTimeUntilHalfOpen())
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  recordSuccess(): void {
    this.onSuccess()
  }

  recordFailure(): void {
    this.onFailure()
  }

  reset(): void {
    logger.info(`Circuit "${this.config.name}" manually reset`)
    this.failureCount = 0
    this.successCount = 0
    this.transitionTo('CLOSED')
  }

  trip(): void {
    logger.info(`Circuit "${this.config.name}" manually tripped`)
    this.lastFailureTime = new Date()
    this.transitionTo('OPEN')
  }
}

export const DEFAULT_CIRCUIT_CONFIG = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000 // 1 minute
} as const

export const AGGRESSIVE_CIRCUIT_CONFIG = {
  failureThreshold: 3,
  successThreshold: 3,
  timeout: 30000 // 30 seconds
} as const

export const LENIENT_CIRCUIT_CONFIG = {
  failureThreshold: 10,
  successThreshold: 1,
  timeout: 120000 // 2 minutes
} as const

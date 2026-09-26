import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.sync.tacticus-api-client')
import { TACTICUS_API } from '@tacticus/app-core/app-config'
import {
  PERMANENT_HTTP_STATUSES,
  TRANSIENT_NONCOUNTING_HTTP_STATUSES,
  TacticusApiError,
  WORKER_CONFIG
} from './worker-types'

// Opens after N consecutive counting errors. Permanent 4xx (one bad key) and
// cause-less local timeouts (event-loop starvation) do not count.
export class CircuitBreaker {
  private failureCount = 0
  private lastFailureTime: number | null = null
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'

  constructor(
    private failureThreshold = 2,
    private recoveryTimeMs = 30000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - (this.lastFailureTime || 0) > this.recoveryTimeMs) {
        // Reset the counter too, or a non-counting probe error leaves it at the
        // threshold and any single failure re-opens the shared breaker.
        this.state = 'HALF_OPEN'
        this.failureCount = 0
      } else {
        throw new Error('Circuit breaker is OPEN — too many recent failures')
      }
    }

    try {
      const result = await operation()
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED'
      }
      this.failureCount = 0
      return result
    } catch (error) {
      if (CircuitBreaker.shouldCount(error)) {
        this.failureCount++
        this.lastFailureTime = Date.now()
        if (this.failureCount >= this.failureThreshold) {
          this.state = 'OPEN'
        }
      }
      throw error
    }
  }

  private static shouldCount(error: unknown): boolean {
    if (error instanceof TacticusApiError && error.isPermanent) return false
    // Transient 4xx (408/425/429) after retries: one throttled guild must not open the shared breaker.
    if (error instanceof Error) {
      const m = /API returned (\d{3})/.exec(error.message)
      if (m && TRANSIENT_NONCOUNTING_HTTP_STATUSES.has(Number(m[1])))
        return false
    }
    // A cause-less timeout/abort is our own deadline (TimeoutError or AbortError).
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      const cause = (error as Error & { cause?: unknown }).cause
      if (cause === undefined) return false
    }
    return true
  }
}

const apiCircuitBreaker = new CircuitBreaker(2, 30000)

// Permanent 4xx fail immediately; 5xx, timeouts and 408/425/429 retry with backoff.
export async function fetchTacticusApi(
  endpoint: string,
  apiKey: string,
  guildCode: string
): Promise<Response> {
  // The breaker wraps the whole retry loop so a call counts at most once, after
  // retries; inside the loop one guild's retries could open it for everyone.
  return await apiCircuitBreaker.execute(async () => {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= WORKER_CONFIG.maxRetries; attempt++) {
      try {
        const response = await fetch(`${TACTICUS_API.BASE_URL}${endpoint}`, {
          headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(WORKER_CONFIG.apiTimeout)
        })

        if (PERMANENT_HTTP_STATUSES.has(response.status)) {
          throw new TacticusApiError(response.status, guildCode)
        }

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`)
        }

        // Empty 2xx body becomes '{}' so callers' .json() cannot throw outside the wrapper.
        if (
          response.status === 204 ||
          response.headers?.get('content-length') === '0'
        ) {
          return new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        }

        return response
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (error instanceof TacticusApiError && error.isPermanent) {
          throw error
        }

        if (attempt < WORKER_CONFIG.maxRetries) {
          const delay = WORKER_CONFIG.retryDelay * Math.pow(2, attempt) // 1s, 2s
          logger.warn(
            {
              err: lastError,
              guildCode,
              attempt: attempt + 1,
              retryDelayMs: delay
            },
            'Tacticus API attempt failed; retrying'
          )
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError || new Error('API call failed after retries')
  })
}

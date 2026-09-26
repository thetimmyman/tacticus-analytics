export type RetryStrategy = 'fixed' | 'exponential' | 'linear'

export interface RetryDecision {
  shouldRetry: boolean
  reason?: string
}

export type OnRetryCallback = (
  attempt: number,
  error: Error,
  delayMs: number,
  context?: RetryContext
) => void | Promise<void>

export type RetryCondition = (
  error: Error,
  attempt: number
) => boolean | RetryDecision

export interface RetryContext {
  operationName?: string
  retryId?: string
  metadata?: Record<string, unknown>
}

export interface RetryMetrics {
  operationName: string
  attempts: number
  success: boolean
  totalDurationMs: number
  attemptDurations: number[]
  lastError?: string
  startedAt: Date
  completedAt: Date
}

export interface RetryPolicy {
  maxAttempts: number

  /** 'fixed' (same delay), 'exponential' (baseDelayMs * 2^attempt) or 'linear' (baseDelayMs * attempt). @default 'exponential' */
  strategy: RetryStrategy

  baseDelayMs: number

  maxDelayMs: number

  jitter: boolean

  retryOn?: RetryCondition

  onRetry?: OnRetryCallback

  /** Per-attempt timeout in ms; unset means none. */
  attemptTimeout?: number
}

export interface WithRetryOptions extends Partial<RetryPolicy> {
  context?: RetryContext
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  strategy: 'exponential',
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true
}

export const RetryConditions = {
  always: (): boolean => true,

  never: (): boolean => false,

  networkErrors: (error: Error): boolean => {
    const networkErrorPatterns = [
      'fetch failed',
      'network error',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'socket hang up',
      'EPIPE',
      'ENETUNREACH',
      'EAI_AGAIN'
    ]
    const message = error.message.toLowerCase()
    return networkErrorPatterns.some((pattern) =>
      message.includes(pattern.toLowerCase())
    )
  },

  serverErrors: (error: Error): boolean => {
    const message = error.message
    return (
      /\b5\d{2}\b/.test(message) ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    )
  },

  rateLimitErrors: (error: Error): boolean => {
    return (
      error.message.includes('429') ||
      error.message.toLowerCase().includes('rate limit')
    )
  },

  timeoutErrors: (error: Error): boolean => {
    const message = error.message.toLowerCase()
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('ETIMEDOUT')
    )
  },

  any:
    (...conditions: RetryCondition[]): RetryCondition =>
    (error, attempt) =>
      conditions.some((c) => {
        const result = c(error, attempt)
        return typeof result === 'boolean' ? result : result.shouldRetry
      }),

  all:
    (...conditions: RetryCondition[]): RetryCondition =>
    (error, attempt) =>
      conditions.every((c) => {
        const result = c(error, attempt)
        return typeof result === 'boolean' ? result : result.shouldRetry
      }),

  not:
    (condition: RetryCondition): RetryCondition =>
    (error, attempt) => {
      const result = condition(error, attempt)
      return typeof result === 'boolean' ? !result : !result.shouldRetry
    }
} as const

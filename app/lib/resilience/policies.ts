import {
  RetryConditions,
  type RetryPolicy,
  type WithRetryOptions
} from './retry-policy'

/** 3 attempts, exponential 1s → 2s → 4s with jitter. */
export const STANDARD_POLICY: RetryPolicy = {
  maxAttempts: 3,
  strategy: 'exponential',
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitter: true
}

export const TACTICUS_API_POLICY: WithRetryOptions = {
  ...STANDARD_POLICY,
  retryOn: RetryConditions.any(
    RetryConditions.networkErrors,
    RetryConditions.serverErrors
  )
}

import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.resilience.with-retry')
import {
  DEFAULT_RETRY_POLICY,
  RetryConditions,
  type RetryContext,
  type RetryMetrics,
  type RetryPolicy,
  type WithRetryOptions
} from './retry-policy'

export class RetryCancelledError extends Error {
  constructor(
    public readonly operationName: string,
    public readonly attempt: number
  ) {
    super(`Operation "${operationName}" was cancelled on attempt ${attempt}`)
    this.name = 'RetryCancelledError'
  }
}

export class RetryTimeoutError extends Error {
  constructor(
    public readonly operationName: string,
    public readonly timeoutMs: number,
    public readonly attempt: number
  ) {
    super(
      `Operation "${operationName}" timed out after ${timeoutMs}ms on attempt ${attempt}`
    )
    this.name = 'RetryTimeoutError'
  }
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly operationName: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(
      `Operation "${operationName}" failed after ${attempts} attempts: ${lastError.message}`
    )
    this.name = 'RetryExhaustedError'
    this.cause = lastError
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const timeout = setTimeout(resolve, ms)

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Aborted'))
      },
      { once: true }
    )
  })
}

/** Capped at maxDelayMs before jitter, which adds 0-50%. */
function calculateDelay(attempt: number, policy: RetryPolicy): number {
  let delay: number

  switch (policy.strategy) {
    case 'fixed':
      delay = policy.baseDelayMs
      break
    case 'linear':
      delay = policy.baseDelayMs * attempt
      break
    case 'exponential':
      delay = policy.baseDelayMs * Math.pow(2, attempt - 1)
      break
    default:
      delay = policy.baseDelayMs
  }

  delay = Math.min(delay, policy.maxDelayMs)

  if (policy.jitter) {
    delay = Math.floor(delay * (1 + Math.random() * 0.5))
  }

  return delay
}

function generateRetryId(): string {
  return `retry-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string,
  attempt: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RetryTimeoutError(operationName, timeoutMs, attempt))
    }, timeoutMs)

    operation()
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

class RetryMetricsCollector {
  private metrics: RetryMetrics[] = []
  private readonly maxMetrics = 1000

  record(metric: RetryMetrics): void {
    this.metrics.push(metric)
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics)
    }
  }

  getStats(): {
    totalOperations: number
    successfulOperations: number
    failedOperations: number
    averageAttempts: number
    averageDurationMs: number
    recentMetrics: RetryMetrics[]
  } {
    const recent = this.metrics.slice(-100)
    const withRetries = recent.filter((m) => m.attempts > 1)

    return {
      totalOperations: this.metrics.length,
      successfulOperations: this.metrics.filter((m) => m.success).length,
      failedOperations: this.metrics.filter((m) => !m.success).length,
      averageAttempts:
        withRetries.length > 0
          ? withRetries.reduce((sum, m) => sum + m.attempts, 0) /
            withRetries.length
          : 1,
      averageDurationMs:
        recent.length > 0
          ? recent.reduce((sum, m) => sum + m.totalDurationMs, 0) /
            recent.length
          : 0,
      recentMetrics: recent.slice(-10)
    }
  }

  clear(): void {
    this.metrics = []
  }
}

export const retryMetricsCollector = new RetryMetricsCollector()

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: WithRetryOptions = {},
  signal?: AbortSignal
): Promise<T> {
  const policy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    ...options
  }

  const context: RetryContext = {
    operationName: 'unknown',
    retryId: generateRetryId(),
    ...options.context
  }

  const operationName = context.operationName || 'unknown'

  const startTime = Date.now()
  const attemptDurations: number[] = []
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new RetryCancelledError(operationName, attempt)
    }

    const attemptStart = Date.now()

    try {
      let result: T
      if (policy.attemptTimeout) {
        result = await withTimeout(
          operation,
          policy.attemptTimeout,
          operationName,
          attempt
        )
      } else {
        result = await operation()
      }

      const attemptDuration = Date.now() - attemptStart
      attemptDurations.push(attemptDuration)

      const totalDuration = Date.now() - startTime
      retryMetricsCollector.record({
        operationName,
        attempts: attempt,
        success: true,
        totalDurationMs: totalDuration,
        attemptDurations,
        startedAt: new Date(startTime),
        completedAt: new Date()
      })

      if (attempt > 1) {
        logger.info(
          {
            retryId: context.retryId,
            totalDurationMs: totalDuration
          },
          `Operation "${operationName}" succeeded after ${attempt} attempts`
        )
      }

      return result
    } catch (error) {
      lastError = error as Error
      const attemptDuration = Date.now() - attemptStart
      attemptDurations.push(attemptDuration)

      if (attempt === policy.maxAttempts) {
        break
      }

      const retryCondition = policy.retryOn || RetryConditions.always
      const shouldRetry = retryCondition(lastError, attempt)
      const shouldRetryBool =
        typeof shouldRetry === 'boolean' ? shouldRetry : shouldRetry.shouldRetry

      if (!shouldRetryBool) {
        logger.debug(
          {
            retryId: context.retryId,
            attempt,
            error: lastError.message
          },
          `Operation "${operationName}" failed with non-retryable error`
        )
        break
      }

      const delay = calculateDelay(attempt, policy)

      logger.debug(
        {
          retryId: context.retryId,
          attempt,
          maxAttempts: policy.maxAttempts,
          delayMs: delay,
          error: lastError.message
        },
        `Operation "${operationName}" failed, retrying in ${delay}ms`
      )

      if (policy.onRetry) {
        try {
          await policy.onRetry(attempt, lastError, delay, context)
        } catch (callbackError) {
          logger.warn(
            {
              error: callbackError
            },
            `onRetry callback failed for "${operationName}"`
          )
        }
      }

      try {
        await sleep(delay, signal)
      } catch {
        throw new RetryCancelledError(operationName, attempt + 1)
      }
    }
  }

  const totalDuration = Date.now() - startTime
  retryMetricsCollector.record({
    operationName,
    attempts: attemptDurations.length,
    success: false,
    totalDurationMs: totalDuration,
    attemptDurations,
    lastError: lastError?.message,
    startedAt: new Date(startTime),
    completedAt: new Date()
  })

  logger.warn(
    {
      retryId: context.retryId,
      totalDurationMs: totalDuration,
      error: lastError?.message
    },
    `Operation "${operationName}" failed after ${attemptDurations.length} attempts`
  )

  throw lastError!
}

export function createRetryWrapper(defaultOptions: WithRetryOptions) {
  return <T>(
    operation: () => Promise<T>,
    context?: RetryContext,
    signal?: AbortSignal
  ): Promise<T> => {
    return withRetry(
      operation,
      {
        ...defaultOptions,
        context: { ...defaultOptions.context, ...context }
      },
      signal
    )
  }
}

/** Retries each item independently; failures do not abort the batch. */
export async function withBatchRetry<TItem, TResult>(
  items: TItem[],
  operation: (item: TItem) => Promise<TResult>,
  options: WithRetryOptions & { maxConcurrency?: number } = {}
): Promise<{
  successful: Map<TItem, TResult>
  failed: Map<TItem, Error>
}> {
  const maxConcurrency = options.maxConcurrency || 5
  const successful = new Map<TItem, TResult>()
  const failed = new Map<TItem, Error>()

  for (let i = 0; i < items.length; i += maxConcurrency) {
    const batch = items.slice(i, i + maxConcurrency)

    const promises = batch.map(async (item) => {
      try {
        const result = await withRetry(() => operation(item), {
          ...options,
          context: {
            ...options.context,
            metadata: { ...options.context?.metadata, batchItem: item }
          }
        })
        successful.set(item, result)
      } catch (error) {
        failed.set(item, error as Error)
      }
    })

    await Promise.all(promises)
  }

  return { successful, failed }
}

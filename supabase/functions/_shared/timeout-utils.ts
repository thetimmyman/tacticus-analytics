// Every edge operation is capped by the time left before the runtime limit.
import {
  getSyncTimeouts,
  TimeoutContext,
  createTimeoutSignal,
  calculateRetryDelay,
  type SyncTimeoutConfig
} from './sync-timeouts-deno.ts'

type TimeoutOperation =
  | 'guild_sync'
  | 'api_request'
  | 'individual_call'
  | 'batch_operation'
  | 'view_guild'
  | 'fetch_global_leaderboard'

export class EdgeFunctionTimeouts {
  private config: SyncTimeoutConfig
  private context: TimeoutContext

  constructor(functionName: string = 'edge-function') {
    this.config = getSyncTimeouts()
    this.context = new TimeoutContext(
      this.config.EDGE_FUNCTION_BUFFER,
      functionName
    )
  }

  getTimeout(operationType: TimeoutOperation): number {
    const remaining = this.context.getRemaining()

    switch (operationType) {
      case 'guild_sync':
        return Math.min(this.config.GUILD_SYNC_BATCH, remaining)
      case 'api_request':
        return Math.min(this.config.API_REQUEST, remaining)
      case 'individual_call':
        return Math.min(this.config.INDIVIDUAL_CALL, remaining)
      case 'batch_operation':
        return Math.min(this.config.WORKER_PROCESS, remaining)
      default:
        return Math.min(this.config.INDIVIDUAL_CALL, remaining)
    }
  }

  createSignal(operationType: TimeoutOperation): AbortSignal {
    const timeout = this.getTimeout(operationType)
    return createTimeoutSignal(timeout)
  }

  canStartOperation(operationType: TimeoutOperation): boolean {
    const requiredTime = this.getTimeout(operationType)
    return this.context.hasTime(requiredTime)
  }

  shouldTerminate(): boolean {
    return this.context.shouldTerminateEarly()
  }

  getMetrics() {
    return {
      elapsed: this.context.getElapsed(),
      remaining: this.context.getRemaining(),
      progress: this.context.getElapsed() / this.config.EDGE_FUNCTION_BUFFER,
      shouldTerminate: this.shouldTerminate()
    }
  }

  createChildContext(
    operationType: Exclude<TimeoutOperation, 'batch_operation'>,
    childName: string
  ): TimeoutContext {
    const timeout = this.getTimeout(operationType)
    return this.context.createChildContext(timeout, childName)
  }
}

export async function timeoutFetch(
  url: string,
  options: RequestInit,
  operationType: Exclude<TimeoutOperation, 'batch_operation'>,
  timeouts: EdgeFunctionTimeouts
): Promise<Response> {
  const signal = timeouts.createSignal(operationType)
  const fetchOptions = {
    ...options,
    signal
  }

  try {
    return await fetch(url, fetchOptions)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timeout = timeouts.getTimeout(operationType)
      throw new Error(`Request timed out after ${timeout}ms (${operationType})`)
    }
    throw error
  }
}

export async function retryWithTimeout<T>(
  operation: () => Promise<T>,
  operationType: Exclude<TimeoutOperation, 'batch_operation'>,
  timeouts: EdgeFunctionTimeouts,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (!timeouts.canStartOperation(operationType)) {
      throw new Error(
        `Insufficient time remaining for ${operationType} attempt ${attempt + 1}`
      )
    }

    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === maxRetries) {
        break
      }

      const delayMs = calculateRetryDelay(attempt)

      const nextAttemptTime = delayMs + timeouts.getTimeout(operationType)
      const metrics = timeouts.getMetrics()
      if (metrics.remaining < nextAttemptTime) {
        throw new Error(
          `Insufficient time for retry ${attempt + 1}: need ${nextAttemptTime}ms, have ${metrics.remaining}ms`
        )
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError!
}

export async function processBatchWithTimeout<T, R>(
  items: T[],
  processor: (item: T, timeouts: EdgeFunctionTimeouts) => Promise<R>,
  timeouts: EdgeFunctionTimeouts,
  batchSize: number = 10
): Promise<R[]> {
  const results: R[] = []

  for (let i = 0; i < items.length; i += batchSize) {
    if (timeouts.shouldTerminate()) {
      console.warn(`⚠️ Early termination: processed ${i}/${items.length} items`)
      break
    }

    const batch = items.slice(i, i + batchSize)
    const batchPromises = batch.map((item) => processor(item, timeouts))

    try {
      const batchResults = await Promise.allSettled(batchPromises)

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          console.error('Batch item failed:', result.reason)
        }
      }
    } catch (error) {
      console.error(`Batch ${i}-${i + batchSize} failed:`, error)
    }

    if (
      i + batchSize < items.length &&
      timeouts.getMetrics().remaining > 1000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  return results
}

export function createTimeoutResponse(
  timeouts: EdgeFunctionTimeouts,
  results: ReadonlyArray<unknown>
) {
  const metrics = timeouts.getMetrics()

  return new Response(
    JSON.stringify({
      success: true,
      results,
      execution: {
        elapsed_ms: metrics.elapsed,
        remaining_ms: metrics.remaining,
        progress_percent: Math.round(metrics.progress * 100),
        early_termination: metrics.shouldTerminate,
        items_processed: results.length
      },
      timestamp: new Date().toISOString()
    }),
    {
      headers: { 'Content-Type': 'application/json' }
    }
  )
}

export function createTimeoutErrorResponse(
  error: Error,
  timeouts: EdgeFunctionTimeouts,
  context: string = 'edge-function'
) {
  const metrics = timeouts.getMetrics()

  return new Response(
    JSON.stringify({
      success: false,
      error: 'Internal server error',
      context,
      execution: {
        elapsed_ms: metrics.elapsed,
        remaining_ms: metrics.remaining,
        progress_percent: Math.round(metrics.progress * 100),
        timeout_triggered:
          error.message.includes('timeout') || error.message.includes('abort')
      },
      timestamp: new Date().toISOString()
    }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }
  )
}

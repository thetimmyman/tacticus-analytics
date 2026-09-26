/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  withRetry,
  withBatchRetry,
  createRetryWrapper,
  RetryCancelledError,
  RetryTimeoutError,
  retryMetricsCollector
} from '@/app/lib/resilience/with-retry'
import { RetryConditions } from '@/app/lib/resilience'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('withRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    retryMetricsCollector.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Successful Operations', () => {
    it('returns result on first attempt success', async () => {
      const operation = vi.fn().mockResolvedValue('success')

      const result = await withRetry(operation, { maxAttempts: 3 })

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('retries and succeeds on second attempt', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue('success')

      const resultPromise = withRetry(operation, {
        maxAttempts: 3,
        strategy: 'fixed',
        baseDelayMs: 100,
        jitter: false
      })

      await vi.advanceTimersByTimeAsync(100)

      const result = await resultPromise
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('retries and succeeds on third attempt', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success')

      const resultPromise = withRetry(operation, {
        maxAttempts: 3,
        strategy: 'fixed',
        baseDelayMs: 100,
        jitter: false
      })

      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      const result = await resultPromise
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
    })
  })

  describe('Failed Operations', () => {
    it('throws after max attempts exhausted', async () => {
      // Real timers avoid unhandled rejections with fake timers.
      vi.useRealTimers()

      const error = new Error('Persistent failure')
      const operation = vi.fn().mockRejectedValue(error)

      await expect(
        withRetry(operation, {
          maxAttempts: 3,
          strategy: 'fixed',
          baseDelayMs: 10,
          jitter: false
        })
      ).rejects.toThrow('Persistent failure')
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('throws immediately for non-retryable errors', async () => {
      const error = new Error('Non-retryable error')
      const operation = vi.fn().mockRejectedValue(error)

      await expect(
        withRetry(operation, {
          maxAttempts: 3,
          retryOn: () => false
        })
      ).rejects.toThrow('Non-retryable error')

      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  describe('Retry Strategies', () => {
    it('uses fixed delay strategy', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()

      const resultPromise = withRetry(operation, {
        maxAttempts: 3,
        strategy: 'fixed',
        baseDelayMs: 1000,
        jitter: false,
        onRetry
      })

      await vi.advanceTimersByTimeAsync(1000)
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        1,
        expect.any(Error),
        1000,
        expect.any(Object)
      )

      await vi.advanceTimersByTimeAsync(1000)
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        2,
        expect.any(Error),
        1000,
        expect.any(Object)
      )

      await resultPromise
    })

    it('uses exponential backoff strategy', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()

      const resultPromise = withRetry(operation, {
        maxAttempts: 3,
        strategy: 'exponential',
        baseDelayMs: 1000,
        jitter: false,
        onRetry
      })

      await vi.advanceTimersByTimeAsync(1000)
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        1,
        expect.any(Error),
        1000,
        expect.any(Object)
      )

      await vi.advanceTimersByTimeAsync(2000)
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        2,
        expect.any(Error),
        2000,
        expect.any(Object)
      )

      await resultPromise
    })

    it('uses linear backoff strategy', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()

      const resultPromise = withRetry(operation, {
        maxAttempts: 3,
        strategy: 'linear',
        baseDelayMs: 1000,
        jitter: false,
        onRetry
      })

      await vi.advanceTimersByTimeAsync(1000)
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        1,
        expect.any(Error),
        1000,
        expect.any(Object)
      )

      await vi.advanceTimersByTimeAsync(2000)
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        2,
        expect.any(Error),
        2000,
        expect.any(Object)
      )

      await resultPromise
    })

    it('caps delay at maxDelayMs', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()

      const resultPromise = withRetry(operation, {
        maxAttempts: 5,
        strategy: 'exponential',
        baseDelayMs: 1000,
        maxDelayMs: 3000,
        jitter: false,
        onRetry
      })

      await vi.advanceTimersByTimeAsync(1000) // 1st: 1000
      await vi.advanceTimersByTimeAsync(2000) // 2nd: 2000
      await vi.advanceTimersByTimeAsync(3000) // 3rd: capped at 3000 (would be 4000)
      await vi.advanceTimersByTimeAsync(3000) // 4th: capped at 3000 (would be 8000)

      await resultPromise

      expect(onRetry).toHaveBeenNthCalledWith(
        3,
        3,
        expect.any(Error),
        3000,
        expect.any(Object)
      )
      expect(onRetry).toHaveBeenNthCalledWith(
        4,
        4,
        expect.any(Error),
        3000,
        expect.any(Object)
      )
    })
  })

  describe('Retry Conditions', () => {
    it('retryOn: networkErrors detects fetch failures', () => {
      expect(RetryConditions.networkErrors(new Error('fetch failed'))).toBe(
        true
      )
      expect(RetryConditions.networkErrors(new Error('ECONNRESET'))).toBe(true)
      expect(RetryConditions.networkErrors(new Error('socket hang up'))).toBe(
        true
      )
      expect(RetryConditions.networkErrors(new Error('validation error'))).toBe(
        false
      )
    })

    it('retryOn: serverErrors detects 5xx errors', () => {
      expect(RetryConditions.serverErrors(new Error('HTTP 500'))).toBe(true)
      expect(RetryConditions.serverErrors(new Error('502 Bad Gateway'))).toBe(
        true
      )
      expect(RetryConditions.serverErrors(new Error('HTTP 400'))).toBe(false)
    })

    it('retryOn: rateLimitErrors detects 429 errors', () => {
      expect(
        RetryConditions.rateLimitErrors(new Error('429 Too Many Requests'))
      ).toBe(true)
      expect(
        RetryConditions.rateLimitErrors(new Error('rate limit exceeded'))
      ).toBe(true)
      expect(RetryConditions.rateLimitErrors(new Error('HTTP 500'))).toBe(false)
    })

    it('retryOn: any combines conditions with OR', () => {
      const condition = RetryConditions.any(
        RetryConditions.networkErrors,
        RetryConditions.serverErrors
      )

      expect(condition(new Error('fetch failed'), 1)).toBe(true)
      expect(condition(new Error('HTTP 500'), 1)).toBe(true)
      expect(condition(new Error('validation error'), 1)).toBe(false)
    })

    it('retryOn: all combines conditions with AND', () => {
      const alwaysTrue: () => boolean = () => true
      const condition = RetryConditions.all(
        alwaysTrue,
        RetryConditions.networkErrors
      )

      expect(condition(new Error('fetch failed'), 1)).toBe(true)
      expect(condition(new Error('validation error'), 1)).toBe(false)
    })

    it('retryOn: not negates a condition', () => {
      const condition = RetryConditions.not(RetryConditions.networkErrors)

      expect(condition(new Error('fetch failed'), 1)).toBe(false)
      expect(condition(new Error('validation error'), 1)).toBe(true)
    })
  })

  describe('Cancellation', () => {
    it('throws RetryCancelledError when signal is aborted', async () => {
      const controller = new AbortController()
      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      const resultPromise = withRetry(
        operation,
        {
          maxAttempts: 5,
          strategy: 'fixed',
          baseDelayMs: 1000,
          jitter: false,
          context: { operationName: 'testOperation' }
        },
        controller.signal
      )

      controller.abort()

      await expect(resultPromise).rejects.toBeInstanceOf(RetryCancelledError)
    })

    it('checks signal before first attempt', async () => {
      const controller = new AbortController()
      controller.abort() // Pre-abort

      const operation = vi.fn().mockResolvedValue('success')

      await expect(
        withRetry(
          operation,
          { context: { operationName: 'testOperation' } },
          controller.signal
        )
      ).rejects.toBeInstanceOf(RetryCancelledError)

      expect(operation).not.toHaveBeenCalled()
    })
  })

  describe('Timeout', () => {
    it('times out individual attempts', async () => {
      vi.useRealTimers()

      const operation = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve('success'), 500)
          })
      )

      await expect(
        withRetry(operation, {
          maxAttempts: 1,
          attemptTimeout: 50,
          context: { operationName: 'slowOperation' }
        })
      ).rejects.toBeInstanceOf(RetryTimeoutError)
    })
  })

  describe('Callbacks', () => {
    it('calls onRetry before each retry', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('First'))
        .mockRejectedValueOnce(new Error('Second'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()

      const resultPromise = withRetry(operation, {
        maxAttempts: 3,
        strategy: 'fixed',
        baseDelayMs: 100,
        jitter: false,
        onRetry
      })

      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      await resultPromise

      expect(onRetry).toHaveBeenCalledTimes(2)
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        1,
        expect.objectContaining({ message: 'First' }),
        100,
        expect.any(Object)
      )
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        2,
        expect.objectContaining({ message: 'Second' }),
        100,
        expect.any(Object)
      )
    })
  })

  describe('Metrics Collection', () => {
    it('records successful operations', async () => {
      const operation = vi.fn().mockResolvedValue('success')

      await withRetry(operation, {
        context: { operationName: 'testOp' }
      })

      const stats = retryMetricsCollector.getStats()
      expect(stats.totalOperations).toBe(1)
      expect(stats.successfulOperations).toBe(1)
      expect(stats.failedOperations).toBe(0)
    })

    it('records failed operations', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      try {
        await withRetry(operation, {
          maxAttempts: 1,
          context: { operationName: 'testOp' }
        })
      } catch {
        // Expected
      }

      const stats = retryMetricsCollector.getStats()
      expect(stats.totalOperations).toBe(1)
      expect(stats.failedOperations).toBe(1)
    })
  })
})

describe('withBatchRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('processes all items successfully', async () => {
    const items = [1, 2, 3]
    const operation = vi.fn().mockImplementation(async (x) => x * 2)

    const { successful, failed } = await withBatchRetry(items, operation, {
      maxAttempts: 1
    })

    expect(successful.size).toBe(3)
    expect(failed.size).toBe(0)
    expect(successful.get(1)).toBe(2)
    expect(successful.get(2)).toBe(4)
    expect(successful.get(3)).toBe(6)
  })

  it('captures failures separately', async () => {
    const items = [1, 2, 3]
    const operation = vi.fn().mockImplementation(async (x) => {
      if (x === 2) throw new Error('Failed for 2')
      return x * 2
    })

    const { successful, failed } = await withBatchRetry(items, operation, {
      maxAttempts: 1
    })

    expect(successful.size).toBe(2)
    expect(failed.size).toBe(1)
    expect(failed.get(2)).toBeInstanceOf(Error)
  })

  it('respects maxConcurrency', async () => {
    const items = [1, 2, 3, 4, 5]
    let concurrent = 0
    let maxConcurrent = 0

    const operation = vi.fn().mockImplementation(async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 10))
      concurrent--
    })

    const resultPromise = withBatchRetry(items, operation, {
      maxAttempts: 1,
      maxConcurrency: 2
    })

    await vi.advanceTimersByTimeAsync(100)

    await resultPromise

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })
})

describe('createRetryWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a reusable wrapper with preset options', async () => {
    const wrapper = createRetryWrapper({
      maxAttempts: 2,
      strategy: 'fixed',
      baseDelayMs: 100,
      jitter: false
    })

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success')

    const resultPromise = wrapper(operation, { operationName: 'test' })

    await vi.advanceTimersByTimeAsync(100)

    const result = await resultPromise
    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('allows context override', async () => {
    const wrapper = createRetryWrapper({
      maxAttempts: 1,
      context: { operationName: 'default' }
    })

    const operation = vi.fn().mockResolvedValue('success')

    await wrapper(operation, { operationName: 'overridden' })

    expect(operation).toHaveBeenCalled()
  })
})

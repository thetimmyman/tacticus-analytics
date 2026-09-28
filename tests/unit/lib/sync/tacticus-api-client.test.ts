import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@tacticus/app-core/app-config', () => ({
  TACTICUS_API: { BASE_URL: 'https://api.tacticusgame.com' }
}))

import { CircuitBreaker } from '@/app/lib/sync/tacticus-api-client'
import { TacticusApiError } from '@/app/lib/sync/worker-types'

describe('CircuitBreaker', () => {
  it('executes operation successfully in CLOSED state', async () => {
    const cb = new CircuitBreaker(2, 30000)
    const result = await cb.execute(() => Promise.resolve('ok'))
    expect(result).toBe('ok')
  })

  it('transitions to OPEN after reaching failure threshold', async () => {
    const cb = new CircuitBreaker(2, 30000)
    const fail = () => cb.execute(() => Promise.reject(new Error('fail')))

    await expect(fail()).rejects.toThrow('fail') // failure 1
    await expect(fail()).rejects.toThrow('fail') // failure 2 → OPEN

    await expect(fail()).rejects.toThrow('Circuit breaker is OPEN')
  })

  it('transitions to HALF_OPEN after recovery time', async () => {
    const cb = new CircuitBreaker(1, 50) // 1 failure threshold, 50ms recovery
    await expect(
      cb.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow('fail')

    await new Promise((resolve) => setTimeout(resolve, 60))

    const result = await cb.execute(() => Promise.resolve('recovered'))
    expect(result).toBe('recovered')

    const result2 = await cb.execute(() => Promise.resolve('ok'))
    expect(result2).toBe('ok')
  })

  it('returns to OPEN if HALF_OPEN attempt fails', async () => {
    const cb = new CircuitBreaker(1, 50)
    await expect(
      cb.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow('fail')

    await new Promise((resolve) => setTimeout(resolve, 60))

    await expect(
      cb.execute(() => Promise.reject(new Error('still broken')))
    ).rejects.toThrow('still broken')

    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(
      'Circuit breaker is OPEN'
    )
  })

  it('resets failure count on success — scattered failures never open the breaker', async () => {
    // A success resets the counter, so failures spread across healthy traffic never open the breaker.
    const cb = new CircuitBreaker(2, 30000)
    for (let i = 0; i < 5; i++) {
      await expect(
        cb.execute(() => Promise.reject(new Error('500')))
      ).rejects.toThrow('500') // count → 1
      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok') // success → reset to 0
    }
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  describe('error classification', () => {
    it('does not count permanent 4xx TacticusApiError — breaker stays CLOSED', async () => {
      const cb = new CircuitBreaker(2, 30000)
      const permanent = () =>
        cb.execute(() => Promise.reject(new TacticusApiError(403, 'G1')))

      for (let i = 0; i < 10; i++) {
        await expect(permanent()).rejects.toBeInstanceOf(TacticusApiError)
      }

      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
    })

    it('does not count client-side AbortError without cause — breaker stays CLOSED', async () => {
      const cb = new CircuitBreaker(2, 30000)
      const clientAbort = () => {
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        return cb.execute(() => Promise.reject(err))
      }

      for (let i = 0; i < 10; i++) {
        await expect(clientAbort()).rejects.toThrow('aborted')
      }

      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
    })

    it('counts AbortError WITH a cause set — treated as transient/server-side', async () => {
      const cb = new CircuitBreaker(2, 30000)
      const serverAbort = () => {
        const err = new Error('aborted by peer')
        err.name = 'AbortError'
        ;(err as Error & { cause?: unknown }).cause = new Error('ECONNRESET')
        return cb.execute(() => Promise.reject(err))
      }

      await expect(serverAbort()).rejects.toThrow('aborted') // count 1
      await expect(serverAbort()).rejects.toThrow('aborted') // count 2 → OPEN

      await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(
        'Circuit breaker is OPEN'
      )
    })

    it('does not count a TimeoutError without cause (real AbortSignal.timeout) — breaker stays CLOSED', async () => {
      // AbortSignal.timeout() rejects with 'TimeoutError', which must be excluded too.
      const cb = new CircuitBreaker(2, 30000)
      const localTimeout = () => {
        const err = new Error('The operation was aborted due to timeout')
        err.name = 'TimeoutError'
        return cb.execute(() => Promise.reject(err))
      }

      for (let i = 0; i < 10; i++) {
        await expect(localTimeout()).rejects.toThrow('timeout')
      }

      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
    })

    it('counts a TimeoutError WITH a cause — treated as transient/upstream', async () => {
      const cb = new CircuitBreaker(2, 30000)
      const serverTimeout = () => {
        const err = new Error('timeout with cause')
        err.name = 'TimeoutError'
        ;(err as Error & { cause?: unknown }).cause = new Error('ETIMEDOUT')
        return cb.execute(() => Promise.reject(err))
      }

      await expect(serverTimeout()).rejects.toThrow('timeout') // count 1
      await expect(serverTimeout()).rejects.toThrow('timeout') // count 2 → OPEN
      await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(
        'Circuit breaker is OPEN'
      )
    })

    it('mixed errors: two 500s with a 403 between them still open the breaker', async () => {
      const cb = new CircuitBreaker(2, 30000)

      await expect(
        cb.execute(() => Promise.reject(new Error('500')))
      ).rejects.toThrow('500') // count 1
      await expect(
        cb.execute(() => Promise.reject(new TacticusApiError(403, 'G1')))
      ).rejects.toBeInstanceOf(TacticusApiError) // NOT counted
      await expect(
        cb.execute(() => Promise.reject(new Error('500')))
      ).rejects.toThrow('500') // count 2 → OPEN

      await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(
        'Circuit breaker is OPEN'
      )
    })

    it('HALF_OPEN + permanent error stays HALF_OPEN — does not re-OPEN, does not CLOSE', async () => {
      const cb = new CircuitBreaker(1, 50)

      await expect(
        cb.execute(() => Promise.reject(new Error('boom')))
      ).rejects.toThrow('boom')
      await new Promise((resolve) => setTimeout(resolve, 60)) // recover → HALF_OPEN on next call

      // A permanent error in HALF_OPEN neither closes (upstream not proven healthy) nor re-opens.
      await expect(
        cb.execute(() => Promise.reject(new TacticusApiError(404, 'G1')))
      ).rejects.toBeInstanceOf(TacticusApiError)

      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
    })

    it('HALF_OPEN recovery does not halve the shared threshold — a 4xx probe then ONE 5xx must not re-open', async () => {
      // A non-counting 4xx probe must not leave failureCount at the threshold.
      const cb = new CircuitBreaker(2, 50)
      await expect(
        cb.execute(() => Promise.reject(new Error('500')))
      ).rejects.toThrow('500') // count 1
      await expect(
        cb.execute(() => Promise.reject(new Error('500')))
      ).rejects.toThrow('500') // count 2 → OPEN
      await new Promise((resolve) => setTimeout(resolve, 60)) // recovery elapsed → next call probes HALF_OPEN
      await expect(
        cb.execute(() => Promise.reject(new TacticusApiError(401, 'G1')))
      ).rejects.toBeInstanceOf(TacticusApiError)
      await expect(
        cb.execute(() => Promise.reject(new Error('500')))
      ).rejects.toThrow('500')
      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
    })
  })
})

describe('fetchTacticusApi', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns response on successful API call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'test' })
      })
    )

    vi.resetModules()
    const { fetchTacticusApi } =
      await import('@/app/lib/sync/tacticus-api-client')
    const response = await fetchTacticusApi('/guildRaid', 'test-key', 'GUILD01')
    expect(response.ok).toBe(true)

    const fetchCalls = vi.mocked(fetch).mock.calls
    expect(fetchCalls[0][0]).toBe('https://api.tacticusgame.com/guildRaid')
    expect((fetchCalls[0][1] as RequestInit).headers).toEqual({
      'X-API-KEY': 'test-key',
      Accept: 'application/json'
    })
  })

  it('throws TacticusApiError for 4xx without retrying', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchFn)

    vi.resetModules()
    const { fetchTacticusApi } =
      await import('@/app/lib/sync/tacticus-api-client')
    const { TacticusApiError } = await import('@/app/lib/sync/worker-types')

    await expect(fetchTacticusApi('/guild', 'bad-key', 'G1')).rejects.toThrow(
      TacticusApiError
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('retries on 5xx errors', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchFn)

    vi.resetModules()
    const { fetchTacticusApi } =
      await import('@/app/lib/sync/tacticus-api-client')
    const response = await fetchTacticusApi('/guildRaid', 'key', 'G1')
    expect(response.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('retries on 429 rate-limit (transient 4xx, NOT permanent — must not kill the sync job)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null }
      })
    vi.stubGlobal('fetch', fetchFn)

    vi.resetModules()
    const { fetchTacticusApi } =
      await import('@/app/lib/sync/tacticus-api-client')
    const response = await fetchTacticusApi('/guildRaid', 'key', 'G1')
    expect(response.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('a persistent 429 never opens the shared breaker (per-key throttle is non-counting)', async () => {
    vi.useFakeTimers()
    try {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429 })
      vi.stubGlobal('fetch', fetchFn)
      vi.resetModules()
      const { fetchTacticusApi } =
        await import('@/app/lib/sync/tacticus-api-client')
      const call = () => fetchTacticusApi('/guildRaid', 'key', 'G1')

      for (let i = 0; i < 3; i++) {
        const e = expect(call()).rejects.toThrow('429')
        await vi.runAllTimersAsync()
        await e
      }
      fetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null }
      })
      await expect(call()).resolves.toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('204 / empty-body 2xx returns a parseable {} instead of crashing callers .json()', async () => {
    // A bare 204 would make response.json() throw outside the retry/breaker wrapper.
    for (const mock of [
      { ok: true, status: 204, headers: { get: () => null } },
      {
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === 'content-length' ? '0' : null) }
      }
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mock))
      vi.resetModules()
      const { fetchTacticusApi } =
        await import('@/app/lib/sync/tacticus-api-client')
      const response = await fetchTacticusApi('/guild', 'key', 'G1')
      await expect(response.json()).resolves.toEqual({})
    }
  })

  it('counts a 5xx-after-retries logical call ONCE — one failed call does not open the shared breaker', async () => {
    // The breaker wraps the whole retry loop, so one exhausted call counts once.
    vi.useFakeTimers()
    try {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 })
      vi.stubGlobal('fetch', fetchFn)
      vi.resetModules()
      const { fetchTacticusApi } =
        await import('@/app/lib/sync/tacticus-api-client')
      const call = () => fetchTacticusApi('/guildRaid', 'key', 'G1')

      // Attach the rejection handler before advancing fake timers so it is never unhandled.
      const e1 = expect(call()).rejects.toThrow('503')
      await vi.runAllTimersAsync()
      await e1
      expect(fetchFn.mock.calls.length).toBe(3)

      const e2 = expect(call()).rejects.toThrow('503')
      await vi.runAllTimersAsync()
      await e2
      expect(fetchFn.mock.calls.length).toBe(6) // call 2 did its own 3 attempts → count 2 → OPEN

      await expect(call()).rejects.toThrow('Circuit breaker is OPEN')
      expect(fetchFn.mock.calls.length).toBe(6)
    } finally {
      vi.useRealTimers()
    }
  })
})

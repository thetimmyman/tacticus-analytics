import { describe, it, expect } from 'vitest'
import { CircuitBreaker } from '@/supabase/functions/_shared/sync-modules/circuit-breaker.ts'

/** The edge breaker is shared by every guild in an isolate and parses thrown messages. */

describe('edge CircuitBreaker.shouldCount classification (WI-1810)', () => {
  it('excludes permanent 4xx parsed from "API returned <status>"', () => {
    for (const s of [400, 401, 403, 404]) {
      expect(
        CircuitBreaker.shouldCount(new Error(`API returned ${s}: Forbidden`))
      ).toBe(false)
    }
  })

  it('counts genuine 5xx', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(
        CircuitBreaker.shouldCount(new Error(`API returned ${s}: Bad Gateway`))
      ).toBe(true)
    }
  })

  it('excludes per-key transient 4xx (429/408/425) — a throttled guild must not open the shared breaker', () => {
    for (const s of [408, 425, 429]) {
      expect(
        CircuitBreaker.shouldCount(
          new Error(`API returned ${s}: Too Many Requests`)
        )
      ).toBe(false)
    }
  })

  it('excludes our own local timeout ("Request timed out after ...")', () => {
    expect(
      CircuitBreaker.shouldCount(
        new Error('Request timed out after 30000ms (api_request)')
      )
    ).toBe(false)
  })

  it('counts an unknown / network-level error', () => {
    expect(CircuitBreaker.shouldCount(new Error('ECONNRESET'))).toBe(true)
    expect(CircuitBreaker.shouldCount(new Error('fetch failed'))).toBe(true)
  })
})

describe('edge CircuitBreaker behaviour (WI-1810)', () => {
  it('a permanent 4xx never opens the breaker no matter how many times it fires', async () => {
    const cb = new CircuitBreaker(2, 30000)
    const badKey = () =>
      cb.execute(() =>
        Promise.reject(new Error('API returned 401: Unauthorized'))
      )
    for (let i = 0; i < 10; i++) {
      await expect(badKey()).rejects.toThrow('401')
    }
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('a local timeout never opens the breaker', async () => {
    const cb = new CircuitBreaker(2, 30000)
    const localTimeout = () =>
      cb.execute(() =>
        Promise.reject(
          new Error('Request timed out after 30000ms (api_request)')
        )
      )
    for (let i = 0; i < 10; i++) {
      await expect(localTimeout()).rejects.toThrow('timed out')
    }
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('two genuine 5xx open the breaker; it then fails fast', async () => {
    const cb = new CircuitBreaker(2, 30000)
    const fail = () =>
      cb.execute(() => Promise.reject(new Error('API returned 503: x')))
    await expect(fail()).rejects.toThrow('503') // count 1
    await expect(fail()).rejects.toThrow('503') // count 2 → OPEN
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(
      'Circuit breaker is OPEN'
    )
  })

  it('resets failure count on success — scattered 5xx never open the breaker (consecutive-failure semantics)', async () => {
    const cb = new CircuitBreaker(2, 30000)
    for (let i = 0; i < 5; i++) {
      await expect(
        cb.execute(() => Promise.reject(new Error('API returned 503: x')))
      ).rejects.toThrow('503')
      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok') // success resets to 0
    }
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('HALF_OPEN recovery does not halve the shared threshold — a 4xx probe then ONE 5xx must not re-open', async () => {
    // A non-counting 4xx HALF_OPEN probe must not leave failureCount at the threshold.
    const cb = new CircuitBreaker(2, 50)
    await expect(
      cb.execute(() => Promise.reject(new Error('API returned 503: x')))
    ).rejects.toThrow('503') // count 1
    await expect(
      cb.execute(() => Promise.reject(new Error('API returned 503: x')))
    ).rejects.toThrow('503') // count 2 → OPEN
    await new Promise((resolve) => setTimeout(resolve, 60)) // recovery elapsed → next call probes HALF_OPEN
    await expect(
      cb.execute(() =>
        Promise.reject(new Error('API returned 401: Unauthorized'))
      )
    ).rejects.toThrow('401')
    // ONE transient 5xx from a healthy guild must NOT re-open (would need a 2nd consecutive)
    await expect(
      cb.execute(() => Promise.reject(new Error('API returned 503: x')))
    ).rejects.toThrow('503')
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('global-config-refresh fetch timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts hung APP_START fetches', async () => {
    vi.useFakeTimers()
    let aborted = false

    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              const abortError = new Error('Request timed out')
              abortError.name = 'AbortError'
              reject(abortError)
            },
            { once: true }
          )
        })
      })
    )

    const { discoverLatestHash } =
      await import('@/app/lib/loki/global-config-refresh')
    const resultPromise = discoverLatestHash('loki-user', 'current-hash')
    const rejectionPromise = resultPromise.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(15000)

    expect(aborted).toBe(true)
    await expect(rejectionPromise).resolves.toBeInstanceOf(Error)
  })
})

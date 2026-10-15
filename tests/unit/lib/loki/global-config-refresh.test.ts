import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureProviderMetrics } from '@/app/lib/network/provider-metrics'

vi.mock('server-only', () => ({}))

describe('global-config-refresh fetch timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
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

  it('retains the 15 second CDN attempt timeout without a timeout retry', async () => {
    vi.useFakeTimers()
    vi.stubEnv('PROVIDER_ADMISSION_MODE', 'off')
    let aborted = false
    const wire = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new DOMException('Request timed out', 'AbortError'))
            },
            { once: true }
          )
        })
    )
    vi.stubGlobal('fetch', wire)
    const { fetchGlobalConfig } =
      await import('@/app/lib/loki/global-config-refresh')
    const pending = captureProviderMetrics(async () => {
      await expect(fetchGlobalConfig('a'.repeat(32))).rejects.toMatchObject({
        name: 'AbortError'
      })
    })
    await vi.advanceTimersByTimeAsync(14999)
    expect(aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(aborted).toBe(true)
    expect((await pending).metrics).toEqual({
      api_calls: 1,
      api_errors: 1,
      api_retry_count: 0
    })
    expect(wire).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains the original HTTP error when cancelling the unused CDN body fails', async () => {
    vi.stubEnv('PROVIDER_ADMISSION_MODE', 'off')
    const cancel = vi.fn(async () => {
      throw new Error('synthetic cancellation failure')
    })
    const wire = vi.fn(
      async () => new Response(new ReadableStream({ cancel }), { status: 503 })
    )
    vi.stubGlobal('fetch', wire)
    const { fetchGlobalConfig } =
      await import('@/app/lib/loki/global-config-refresh')
    const measured = await captureProviderMetrics(async () => {
      await expect(fetchGlobalConfig('a'.repeat(32))).rejects.toThrow(
        'returned HTTP 503'
      )
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(wire).toHaveBeenCalledTimes(1)
    expect(measured.metrics).toEqual({
      api_calls: 1,
      api_errors: 1,
      api_retry_count: 0
    })
  })
})

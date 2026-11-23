import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController()
    setTimeout(
      () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
      milliseconds
    )
    return controller.signal
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('carries the upstream status code on a retried 5xx failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 500 }))
  )
  const { fetchTacticusApi } =
    await import('@/app/lib/sync/tacticus-api-client')

  const pending = expect(
    fetchTacticusApi('/guild', 'synthetic-key', 'SYNTHETIC')
  ).rejects.toMatchObject({
    message: 'API returned 500',
    statusCode: 500
  })

  await vi.advanceTimersByTimeAsync(10_000)
  await pending
})

it('carries the throttled status code on a retried 429 failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 429 }))
  )
  const { fetchTacticusApi } =
    await import('@/app/lib/sync/tacticus-api-client')

  const pending = expect(
    fetchTacticusApi('/guild', 'synthetic-key', 'SYNTHETIC')
  ).rejects.toMatchObject({
    message: 'API returned 429',
    statusCode: 429
  })

  await vi.advanceTimersByTimeAsync(10_000)
  await pending
})

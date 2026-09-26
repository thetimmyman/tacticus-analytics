import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAbortTimeout } from '@/app/lib/sync/api-client'

describe('fetchWithAbortTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const installHangingFetch = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('aborted by caller')
                error.name = 'AbortError'
                reject(error)
              },
              { once: true }
            )
          })
      )
    )
  }

  it('preserves a native AbortError by default', async () => {
    vi.useFakeTimers()
    installHangingFetch()

    const request = fetchWithAbortTimeout(
      'https://example.test',
      {},
      50,
      'example response'
    )
    const rejection = expect(request).rejects.toMatchObject({
      name: 'AbortError',
      message: 'aborted by caller'
    })

    await vi.advanceTimersByTimeAsync(50)
    await rejection
  })

  it('converts an AbortError only when the caller opts in', async () => {
    vi.useFakeTimers()
    installHangingFetch()

    const request = fetchWithAbortTimeout(
      'https://example.test',
      {},
      75,
      'example response',
      { convertAbortToTimeoutError: true }
    )
    const rejection = expect(request).rejects.toThrow(
      'Request timed out after 75ms'
    )

    await vi.advanceTimersByTimeAsync(75)
    await rejection
  })
})

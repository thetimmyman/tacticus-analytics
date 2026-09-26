import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/** `pagehide` also fires on entering the bfcache, so each request needs its own AbortController. */

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({ warn: vi.fn(), error: vi.fn() })
}))

import { useSyncFeedFreshness } from '@/app/lib/hooks/useSyncFeedFreshness'

function freshnessOk() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      feeds: [{ key: 'raid', ageSeconds: 120, cadenceSeconds: 3600 }],
      guildCode: 'GUILD'
    })
  }
}

describe('useSyncFeedFreshness — bfcache', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock = vi.fn(async () => freshnessOk())
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('polls with an unaborted signal after a pagehide/restore cycle', async () => {
    renderHook(() => useSyncFeedFreshness(true))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    window.dispatchEvent(new Event('pagehide'))
    fetchMock.mockClear()

    await vi.advanceTimersByTimeAsync(120_000)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0]?.[1] as { signal: AbortSignal }
    expect(init.signal.aborted).toBe(false)
  })

  it('still aborts a poll that is genuinely in flight', async () => {
    fetchMock.mockImplementation(
      () => new Promise(() => {}) as unknown as Promise<Response>
    )
    renderHook(() => useSyncFeedFreshness(true))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0]?.[1] as { signal: AbortSignal }

    window.dispatchEvent(new Event('pagehide'))

    expect(init.signal.aborted).toBe(true)
  })
})

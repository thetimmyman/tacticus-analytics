/**
 * @vitest-environment happy-dom
 *
 * A non-ok response goes through extractErrorMessage, so raw server text never renders.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useQueueData } from '@/app/(dashboard)/guild-management/upcoming-assignments/hooks/useQueueData'

afterEach(() => vi.unstubAllGlobals())

describe('useQueueData error handling (WI-1930)', () => {
  it('falls back to clean copy on a 502 HTML body — never surfaces raw HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('Unexpected token < in JSON')),
        text: () =>
          Promise.resolve(
            '<!DOCTYPE html><html><head></head>Cloudflare 502</html>'
          )
      })
    )

    const { result } = renderHook(() => useQueueData())
    await act(async () => {
      await result.current.fetchQueue('current', '104')
    })

    expect(result.current.error).toBeTruthy()
    expect(result.current.error).not.toContain('<!DOCTYPE')
    expect(result.current.error).not.toContain('<html')
    expect(result.current.error).toContain(
      'Could not load the assignment queue'
    )
  })

  it('posts ONLY mode + season — the legacy excluded_bosses field was removed (WI-4490)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useQueueData())
    await act(async () => {
      await result.current.fetchQueue('current', '104')
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/guild-raid/unified-assignments',
      expect.objectContaining({ method: 'POST' })
    )
    // boss_target_tokens.skip is the only exclusion mechanism; excluded_bosses is gone.
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(body).toEqual({ mode: 'current', season_number: '104' })
  })
})

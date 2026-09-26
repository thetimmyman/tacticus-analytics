import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { ActivityTracker } from '@/app/components/ActivityTracker'

describe('ActivityTracker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('posts activity when the throttle window is exceeded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(600000)

    render(<ActivityTracker />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/user/activity', {
        method: 'POST'
      })
    })
  })

  it('skips posting when within the throttle window', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(100000)

    render(<ActivityTracker />)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

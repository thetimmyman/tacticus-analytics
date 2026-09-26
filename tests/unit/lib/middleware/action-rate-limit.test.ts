import { beforeEach, describe, expect, it, vi } from 'vitest'

const cacheMocks = vi.hoisted(() => ({
  setNx: vi.fn(),
  get: vi.fn()
}))

vi.mock('@tacticus/app-core/app-cache', () => ({
  appCache: cacheMocks
}))

import { checkActionRateLimit } from '@/app/lib/middleware/rate-limit'

describe('checkActionRateLimit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    cacheMocks.setNx.mockReset()
    cacheMocks.get.mockReset()
  })

  it('allows only the caller that atomically acquires the window', async () => {
    cacheMocks.setNx.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    cacheMocks.get.mockResolvedValue(10_000)

    const [first, second] = await Promise.all([
      checkActionRateLimit('provider:scope', 60),
      checkActionRateLimit('provider:scope', 60)
    ])

    expect(first).toEqual({ allowed: true })
    expect(second).toEqual({ allowed: false, remainingTime: 60 })
    expect(cacheMocks.setNx).toHaveBeenCalledTimes(2)
  })

  it('fails closed when acquisition fails without a readable timestamp', async () => {
    cacheMocks.setNx.mockResolvedValue(false)
    cacheMocks.get.mockResolvedValue(null)

    await expect(checkActionRateLimit('provider:scope', 90)).resolves.toEqual({
      allowed: false,
      remainingTime: 90
    })
  })
})

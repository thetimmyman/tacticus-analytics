import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/signout/route'

vi.mock('@/app/lib/auth', () => ({
  signOut: vi.fn()
}))

vi.mock('@tacticus/app-core/app-config', () => ({
  APP_ORIGINS: {
    CURRENT: 'http://localhost:3000'
  }
}))

describe('POST /api/auth/signout', () => {
  let signOut: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const authModule = await import('@/app/lib/auth')
    signOut = vi.mocked(authModule.signOut)
    signOut.mockResolvedValue(undefined)
  })

  it('calls signOut function', async () => {
    await POST()

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('returns redirect response to home page', async () => {
    const response = await POST()

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/')
  })

  it('redirects even if signOut throws', async () => {
    signOut.mockRejectedValue(new Error('Session already expired'))

    await expect(POST()).rejects.toThrow()
  })
})

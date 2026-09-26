import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  return { ...actual, requireActiveMembershipForApi: vi.fn() }
})

vi.mock('@/app/lib/db', () => ({ db: vi.fn(), serviceDb: vi.fn() }))

vi.mock('@/app/lib/data/boss-hp', () => ({
  getAllBossHp: vi.fn().mockResolvedValue({})
}))

vi.mock('@/app/lib/utils/season', () => ({
  getLatestSeason: vi.fn().mockResolvedValue('81')
}))

import { POST } from '@/app/api/boss-assignments/target-tokens/seed/route'
import { AuthError, requireActiveMembershipForApi } from '@/app/lib/auth'

const requireAuthForApiMock = vi.mocked(requireActiveMembershipForApi)

const makeRequest = () =>
  new NextRequest('http://localhost/api/boss-assignments/target-tokens/seed', {
    method: 'POST'
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/boss-assignments/target-tokens/seed', () => {
  it('maps AuthError UNAUTHENTICATED to 401 with { code } metadata (not 500)', async () => {
    requireAuthForApiMock.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
    expect(body.error.metadata).toEqual({ code: 'UNAUTHENTICATED' })
    expect(body.error.statusCode).toBe(401)
  })

  it('maps AuthError INSUFFICIENT_ROLE to 403 with { code } metadata', async () => {
    requireAuthForApiMock.mockRejectedValue(
      new AuthError('Insufficient role', 'INSUFFICIENT_ROLE')
    )

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.metadata).toEqual({ code: 'INSUFFICIENT_ROLE' })
  })

  it('returns the user-facing 403 body when the caller is not an app admin', async () => {
    requireAuthForApiMock.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: 'TEST', role: 'leader', is_app_admin: false }
    } as never)

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.metadata).toEqual({
      error: 'Boss assignments are restricted to app administrators',
      code: 'ACCESS_DENIED',
      version: expect.any(String),
      supportMessage: expect.any(String)
    })
    expect(body.error.message).toBe(
      'Boss assignments are restricted to app administrators'
    )
  })
})

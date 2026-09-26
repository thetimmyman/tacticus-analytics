import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  return { ...actual, requireActiveMembershipForApi: vi.fn() }
})

vi.mock('@/app/lib/db', () => ({ db: vi.fn(), serviceDb: vi.fn() }))

vi.mock('@/app/lib/auth/guild-permissions', () => ({
  requireGuildMember: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/app/lib/data/guild-boss-rotation-stats', () => ({
  getCurrentRotationBossStats: vi.fn()
}))

import { GET } from '@/app/api/boss-assignments/target-tokens/rotation-stats/route'
import { AuthError, requireActiveMembershipForApi } from '@/app/lib/auth'
import { getCurrentRotationBossStats } from '@/app/lib/data/guild-boss-rotation-stats'

const requireAuthForApiMock = vi.mocked(requireActiveMembershipForApi)
const getStatsMock = vi.mocked(getCurrentRotationBossStats)

const makeRequest = (query = '?season=81') =>
  new NextRequest(
    `http://localhost/api/boss-assignments/target-tokens/rotation-stats${query}`
  )

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthForApiMock.mockResolvedValue({
    user: { id: 'user-1' },
    profile: { guild_code: 'TEST', role: 'member' }
  } as never)
})

describe('GET /api/boss-assignments/target-tokens/rotation-stats', () => {
  it('maps AuthError UNAUTHENTICATED to 401 with { code } metadata (not 500)', async () => {
    requireAuthForApiMock.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
    expect(body.error.metadata).toEqual({ code: 'UNAUTHENTICATED' })
    expect(body.error.statusCode).toBe(401)
  })

  it('maps AuthError INSUFFICIENT_ROLE to 403 with { code } metadata', async () => {
    requireAuthForApiMock.mockRejectedValue(
      new AuthError('Guild membership required', 'INSUFFICIENT_ROLE')
    )

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.message).toBe('Guild membership required')
    expect(body.error.metadata).toEqual({ code: 'INSUFFICIENT_ROLE' })
  })

  it('keeps the generic 500 fallthrough for non-auth errors', async () => {
    getStatsMock.mockRejectedValue(new Error('db exploded'))

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.message).toBe('Internal error')
    expect(body.error.metadata).toEqual({ code: 'INTERNAL_ERROR' })
  })
})

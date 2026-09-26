import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  return { ...actual, requireActiveMembershipForApi: vi.fn() }
})

vi.mock('@/app/lib/data/boss-level-token-performance', () => ({
  getBossLevelTokenPerformance: vi.fn()
}))

import { GET } from '@/app/api/boss/token-performance/route'
import { AuthError, requireActiveMembershipForApi } from '@/app/lib/auth'
import { getBossLevelTokenPerformance } from '@/app/lib/data/boss-level-token-performance'

const requireAuthForApiMock = vi.mocked(requireActiveMembershipForApi)
const getPerformanceMock = vi.mocked(getBossLevelTokenPerformance)

const makeRequest = (query = '') =>
  new NextRequest(`http://localhost/api/boss/token-performance${query}`)

const authedProfile = { guild_code: 'TEST', role: 'member' }

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthForApiMock.mockResolvedValue({
    user: { id: 'user-1' },
    profile: authedProfile
  } as never)
})

describe('GET /api/boss/token-performance', () => {
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
      new AuthError('Officer role required', 'INSUFFICIENT_ROLE')
    )

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.message).toBe('Officer role required')
    expect(body.error.metadata).toEqual({ code: 'INSUFFICIENT_ROLE' })
  })

  it('returns the user-facing 400 body when required params are missing', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.metadata).toEqual({
      error: 'guild_code, season, boss, and level are required',
      code: 'VALIDATION_ERROR',
      version: expect.any(String),
      supportMessage: expect.any(String)
    })
    expect(body.error.message).toBe(
      'guild_code, season, boss, and level are required'
    )
  })

  it('returns the user-facing 500 body when the data fetch throws', async () => {
    getPerformanceMock.mockRejectedValue(new Error('db exploded'))

    const res = await GET(
      makeRequest('?guild_code=TEST&season=81&boss=Szarekh&level=1')
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.metadata).toEqual({
      error: 'Failed to fetch boss-level token performance data',
      code: 'HISTORICAL_DATA_FAILED',
      version: expect.any(String),
      supportMessage: expect.any(String)
    })
  })
})

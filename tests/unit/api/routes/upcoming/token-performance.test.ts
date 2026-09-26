import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  return { ...actual, requireRoleForApi: vi.fn() }
})

vi.mock('@/app/lib/data/guild-token-performance', () => ({
  getGuildTokenPerformance: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/app/lib/auth/guild-permissions', () => ({
  requireGuildOfficerOrClusterLeader: vi.fn()
}))

import { GET } from '@/app/api/upcoming/token-performance/route'
import { AuthError, requireRoleForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { getGuildTokenPerformance } from '@/app/lib/data/guild-token-performance'

const requireRoleForApiMock = vi.mocked(requireRoleForApi)
const dbMock = vi.mocked(db)
const requireGuildOfficerOrClusterLeaderMock = vi.mocked(
  requireGuildOfficerOrClusterLeader
)
const getPerformanceMock = vi.mocked(getGuildTokenPerformance)

const makeRequest = (query = '') =>
  new NextRequest(`http://localhost/api/upcoming/token-performance${query}`)

beforeEach(() => {
  vi.clearAllMocks()
  requireRoleForApiMock.mockResolvedValue({
    user: { id: 'user-1' },
    profile: { guild_code: 'TEST', role: 'officer' }
  } as never)
  requireGuildOfficerOrClusterLeaderMock.mockResolvedValue({} as never)
  dbMock.mockResolvedValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { guild_code: 'TEST', cluster_code: 'EOT' },
            error: null
          })
        }))
      }))
    }))
  } as never)
})

describe('GET /api/upcoming/token-performance', () => {
  it('maps AuthError UNAUTHENTICATED to 401 with { code } metadata (not 500)', async () => {
    requireRoleForApiMock.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
    expect(body.error.metadata).toEqual({ code: 'UNAUTHENTICATED' })
  })

  it('returns the user-facing 403 body when the caller is not officer/leader', async () => {
    requireRoleForApiMock.mockRejectedValue(
      new AuthError(
        'Insufficient permissions. Required: officer, Current: member',
        'INSUFFICIENT_ROLE',
        'officer',
        'member'
      )
    )

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.metadata).toEqual({ code: 'INSUFFICIENT_ROLE' })
  })

  it('returns the user-facing 400 body when guild code is missing', async () => {
    requireRoleForApiMock.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: null, role: 'officer' }
    } as never)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.metadata).toEqual({
      error: 'Guild code is required',
      code: 'VALIDATION_ERROR',
      version: expect.any(String),
      supportMessage: expect.any(String)
    })
  })

  it('authorizes the target guild and derives cluster scope from guild_config', async () => {
    getPerformanceMock.mockResolvedValue({ players: [] } as never)

    const res = await GET(
      makeRequest('?guild_code=PEER&compare_mode=cluster&cluster_code=FORGED')
    )

    expect(res.status).toBe(200)
    expect(requireGuildOfficerOrClusterLeaderMock).toHaveBeenCalledWith(
      expect.any(Object),
      'user-1',
      'PEER',
      '/api/upcoming/token-performance'
    )
    expect(getPerformanceMock).toHaveBeenCalledWith(
      'PEER',
      expect.objectContaining({
        compareMode: 'cluster',
        clusterCode: 'EOT'
      })
    )
  })

  it('returns the user-facing 500 body when the data fetch throws', async () => {
    getPerformanceMock.mockRejectedValue(new Error('db exploded'))

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.metadata).toEqual({
      error: 'Failed to fetch token performance data',
      code: 'HISTORICAL_DATA_FAILED',
      version: expect.any(String),
      supportMessage: expect.any(String)
    })
  })
})

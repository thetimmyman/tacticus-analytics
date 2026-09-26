import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

let mockGetAuthUser: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('POST /api/wars/analytics/team', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let mockSupabase: { rpc: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.resetModules()
    mockGetAuthUser = vi.fn()
    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireActiveMembershipForApi: mockGetAuthUser
    }))

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }
    }))

    mockSupabase = { rpc: vi.fn() }
    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/wars/analytics/team/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetAuthUser.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const request = new NextRequest(
      'http://localhost/api/wars/analytics/team',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroKeys: ['a', 'b', 'c', 'd', 'e'] })
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
  })

  it('rejects inactive membership before parsing the body or calling analytics', async () => {
    mockGetAuthUser.mockRejectedValue(
      new AuthError('Current guild membership required', 'ONBOARDING_REQUIRED')
    )
    const request = new NextRequest(
      'http://localhost/api/wars/analytics/team',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json'
      }
    )

    const response = await POST(request)

    expect(response.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns 400 when user has no guild code', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: null } })

    const request = new NextRequest(
      'http://localhost/api/wars/analytics/team',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroKeys: ['a', 'b', 'c', 'd', 'e'] })
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('No guild associated with user')
  })

  it('returns 400 when heroKeys are invalid', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })

    const request = new NextRequest(
      'http://localhost/api/wars/analytics/team',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroKeys: ['a', 'b', 'c'] })
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain(
      'heroKeys must be an array of exactly 5 hero IDs'
    )
  })

  it('returns 500 when RPC fails', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'boom' }
    })

    const request = new NextRequest(
      'http://localhost/api/wars/analytics/team',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heroKeys: ['a', 'b', 'c', 'd', 'e'],
          seasonCount: 2
        })
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('Failed to analyze team composi')
  })

  it('returns default analysis when no data is available', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

    const request = new NextRequest(
      'http://localhost/api/wars/analytics/team',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroKeys: ['a', 'b', 'c', 'd', 'e'] })
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.analysis).toMatchObject({
      totalUsed: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgScore: 0,
      zoneBreakdown: [],
      debuffBreakdown: [],
      matchups: []
    })
  })

  it('returns normalized analysis data on success', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          total_uses: '12',
          wins: 8,
          losses: '4',
          win_rate: '66.7',
          avg_score: '123.4',
          zone_breakdown: [{ zoneName: 'HQ', uses: '5', winRate: '80' }],
          buff_breakdown: [{ debuffLevel: '2x', uses: '4', winRate: '50' }],
          matchup_summary: [{ opponent: 'Enemy', winRate: 55 }]
        }
      ],
      error: null
    })

    const request = new NextRequest(
      'http://localhost/api/wars/analytics/team',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heroKeys: ['a', 'b', 'c', 'd', 'e'],
          seasonCount: 3
        })
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('analyze_team_composition', {
      p_guild_code: 'ABC',
      p_hero_keys: ['a', 'b', 'c', 'd', 'e'],
      p_season_count: 3
    })
    expect(body.analysis).toMatchObject({
      totalUsed: 12,
      wins: 8,
      losses: 4,
      winRate: 66.7,
      avgScore: 123.4
    })
    expect(body.analysis.zoneBreakdown).toEqual([
      { zoneType: 'HQ', uses: 5, winRate: 80 }
    ])
    expect(body.analysis.debuffBreakdown).toEqual([
      { debuffLevel: '2x', uses: 4, winRate: 50 }
    ])
    expect(body.analysis.matchups).toEqual([{ opponent: 'Enemy', winRate: 55 }])
  })

  // zoneDisplayName is not idempotent ('ComsStation' -> 'Vox-Station' -> 'Vox Station').
  it('ships the RAW zone_type on the wire and never formats it', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          total_uses: 3,
          wins: 2,
          losses: 1,
          win_rate: 66.7,
          avg_score: 100,
          zone_breakdown: [{ zoneName: 'ComsStation', uses: 3, winRate: 66.7 }],
          buff_breakdown: [],
          matchup_summary: []
        }
      ],
      error: null
    })

    const request = new NextRequest(
      'http://localhost/api/wars/analytics/team',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroKeys: ['a', 'b', 'c', 'd', 'e'] })
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.analysis.zoneBreakdown).toEqual([
      { zoneType: 'ComsStation', uses: 3, winRate: 66.7 }
    ])
    const entry = body.analysis.zoneBreakdown[0]
    expect(entry).not.toHaveProperty('zoneName')
    expect(JSON.stringify(body)).not.toContain('Vox')
  })
})

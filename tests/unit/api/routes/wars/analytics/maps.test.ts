import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

let mockGetAuthUser: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('GET /api/wars/analytics/maps', () => {
  let GET: (request: NextRequest) => Promise<Response>
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

    const routeModule = await import('@/app/api/wars/analytics/maps/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetAuthUser.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/maps')
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
  })

  it('rejects inactive membership before querying analytics', async () => {
    mockGetAuthUser.mockRejectedValue(
      new AuthError('Current guild membership required', 'ONBOARDING_REQUIRED')
    )

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/maps')
    )

    expect(response.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns 400 when user has no guild code', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/maps')
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('No guild associated with user')
  })

  it('returns 500 when RPC fails', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'boom' }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/maps')
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('Failed to fetch zone stats')
  })

  it('passes RPC rows through unchanged, formatting nothing', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    // Real get_zone_stats shape: raw zone_type, legacy INITCAP projection, NULL map_code.
    const rpcRows = [
      {
        zone_type: 'Trenches1',
        zone_display_name: 'Trenches1',
        map_code: null,
        offense_attacks: 12,
        offense_wins: 7,
        offense_win_rate: 58.3,
        offense_avg_score: 640.5,
        defense_attacks: 9,
        defense_holds: 4,
        defense_hold_rate: 44.4,
        defense_avg_conceded: 512.0
      },
      {
        zone_type: 'ComsStation',
        zone_display_name: 'Comsstation',
        map_code: null,
        offense_attacks: 3,
        offense_wins: 3,
        offense_win_rate: 100,
        offense_avg_score: 810,
        defense_attacks: 0,
        defense_holds: 0,
        defense_hold_rate: 0,
        defense_avg_conceded: 0
      }
    ]
    mockSupabase.rpc.mockResolvedValue({ data: rpcRows, error: null })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/maps?days=14')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_zone_stats', {
      p_guild_code: 'ABC',
      p_days_back: 14,
      p_season_count: undefined
    })
    // zoneDisplayName is not idempotent, so formatting happens once at the render site.
    expect(body.maps).toEqual(rpcRows)
    expect(body.maps[0].zone_display_name).toBe('Trenches1')
    expect(body.maps[1].map_code).toBeNull()
  })

  it('returns an empty list when the RPC returns no rows', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/maps')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.maps).toEqual([])
  })
})

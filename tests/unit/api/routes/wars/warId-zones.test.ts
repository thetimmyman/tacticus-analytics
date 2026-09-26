import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>

describe('GET /api/wars/[warId]/zones', () => {
  let GET: (
    request: NextRequest,
    context: { params: Promise<{ warId: string }> }
  ) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  const buildSingleQuery = (result: {
    data: Record<string, unknown> | null
    error?: { message: string; code?: string } | null
  }) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result)
  })

  const buildInactiveMembershipQuery = () => {
    const filters: Record<string, unknown> = {}
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string, value: string | boolean) => {
        filters[column] = value
        return query
      }),
      maybeSingle: vi.fn(async () => ({
        data:
          filters.is_current === true ? null : { guild_code: 'FORMER_GUILD' },
        error: null
      }))
    }
    return { filters, query }
  }

  const buildZonesQuery = (result: {
    data: Record<string, unknown>[] | null
    error: { message: string } | null
  }) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result)
  })

  const buildListQuery = (result: {
    data: Record<string, unknown>[] | null
    error: { message: string } | null
  }) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (
        resolve: (value: {
          data: Record<string, unknown>[] | null
          error: { message: string } | null
        }) => unknown
      ) => resolve(result)
    }
    return query
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/wars/[warId]/zones/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/zones'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Unauthorized')
  })

  it('filters for current membership and denies inactive history before war reads', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    const membership = buildInactiveMembershipQuery()
    const tables: string[] = []
    mockSupabase.from.mockImplementation((table: string) => {
      tables.push(table)
      if (table === 'player_mapping') {
        return membership.query
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/zones'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('No guild membership found')
    expect(membership.filters).toEqual({
      user_id: 'user-1',
      is_current: true
    })
    expect(tables).toEqual(['player_mapping'])
  })

  it('denies a membership lookup error before war or zone reads', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    const tables: string[] = []
    mockSupabase.from.mockImplementation((table: string) => {
      tables.push(table)
      if (table === 'player_mapping') {
        return buildSingleQuery({
          data: null,
          error: { message: 'membership lookup failed' }
        })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/zones'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('No guild membership found')
    expect(tables).toEqual(['player_mapping'])
  })

  it('returns 404 when war is not found', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' } })
      }
      if (table === 'guild_war_matches') {
        return buildSingleQuery({ data: null })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/zones'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.message).toBe('War not found')
  })

  it('returns 500 when zones query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' } })
      }
      if (table === 'guild_war_matches') {
        return buildSingleQuery({
          data: { guild_code: 'ABC', war_id: 'war-1' }
        })
      }
      if (table === 'guild_war_zones') {
        return buildZonesQuery({ data: null, error: { message: 'boom' } })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/zones'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('Failed to fetch zones')
    consoleSpy.mockRestore()
  })

  it('returns 500 when the zone battles query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' } })
      }
      if (table === 'guild_war_matches') {
        return buildSingleQuery({
          data: { guild_code: 'ABC', war_id: 'war-1' }
        })
      }
      if (table === 'guild_war_zones') {
        return buildZonesQuery({ data: [], error: null })
      }
      if (table === 'guild_war_battles') {
        return buildListQuery({
          data: null,
          error: { message: 'battle lookup failed' }
        })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/zones'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('Failed to fetch zone battles')
    consoleSpy.mockRestore()
  })

  it('returns mapped zone cells carrying the raw zone_type and no name', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    const battlesQuery = buildListQuery({
      data: [
        {
          zone_id: 'zone-1',
          is_guild_member: true,
          attempt_result: 'win',
          defender_units_json: [{ remainingHPAfter: 50 }],
          score_earned: 100
        },
        {
          zone_id: 'zone-1',
          is_guild_member: true,
          attempt_result: 'win',
          score_earned: 100
        },
        {
          zone_id: 'zone-1',
          is_guild_member: true,
          attempt_result: 'win',
          score_earned: 100
        },
        {
          zone_id: 'zone-2',
          is_guild_member: false,
          attempt_result: 'win',
          defender_units_json: [{ remainingHPAfter: 25 }],
          score_earned: 200
        }
      ],
      error: null
    })
    // Legacy zone_name values are deliberately misleading.
    const zonesQuery = buildZonesQuery({
      data: [
        {
          id: 'zone-1',
          zone_number: 1,
          zone_name: 'Zone 1',
          zone_type: 'Trenches1',
          zone_status: 'in_progress',
          assigned_players: ['PlayerA'],
          zone_score: 100,
          opponent_zone_score: 0,
          zone_result: null,
          attempts_remaining: 2,
          max_attempts: 5
        },
        {
          id: 'zone-2',
          zone_number: 2,
          zone_name: 'HQ',
          zone_type: 'ComsStation',
          zone_status: 'failed',
          assigned_players: null,
          zone_score: null,
          opponent_zone_score: 200,
          zone_result: null,
          attempts_remaining: null,
          max_attempts: null
        }
      ],
      error: null
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' } })
      }
      if (table === 'guild_war_matches') {
        return buildSingleQuery({
          data: { guild_code: 'ABC', war_id: 'war-1' }
        })
      }
      if (table === 'guild_war_zones') {
        return zonesQuery
      }
      if (table === 'guild_war_battles') {
        return battlesQuery
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/zones'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(battlesQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('defender_units_json')
    )

    const zonesSelect = zonesQuery.select.mock.calls[0]?.[0] as string
    expect(zonesSelect).toContain('zone_type')
    expect(zonesSelect).not.toContain('zone_name')

    expect(body).toHaveLength(2)
    expect(body[0]).toMatchObject({
      id: 'zone-1',
      zoneType: 'Trenches1',
      assignedPlayer: 'PlayerA',
      status: 'assigned',
      offense: { attacks: 3, winRate: 66.7, avgScore: 100 },
      defense: { defends: 0, holdRate: 0, avgConceded: 0 }
    })
    expect(body[1]).toMatchObject({
      id: 'zone-2',
      zoneType: 'ComsStation',
      assignedPlayer: null,
      status: 'destroyed',
      offense: { attacks: 0, winRate: 0, avgScore: 0 },
      defense: { defends: 1, holdRate: 100, avgConceded: 200 }
    })

    // zoneDisplayName() is not idempotent, so a pre-formatted twin would be double-formatted.
    expect(body[0]).not.toHaveProperty('zoneName')
    expect(body[1]).not.toHaveProperty('zoneName')
    expect(JSON.stringify(body)).not.toContain('Vox-Station')
  })
})

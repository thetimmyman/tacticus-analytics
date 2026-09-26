import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>

describe('GET /api/wars/[warId]/maps', () => {
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
    error?: Record<string, unknown>
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

  const buildEqQuery = (result: { data: Record<string, unknown>[] }) => {
    let callCount = 0
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation(() => {
        callCount += 1
        return callCount >= 2 ? Promise.resolve(result) : query
      })
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

    const routeModule = await import('@/app/api/wars/[warId]/maps/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/maps'),
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
      new NextRequest('http://localhost/api/wars/war-1/maps'),
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
      new NextRequest('http://localhost/api/wars/war-1/maps'),
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
      new NextRequest('http://localhost/api/wars/war-1/maps'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.message).toBe('War not found')
  })

  it('returns empty array when no zones exist', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' } })
      }
      if (table === 'guild_war_matches') {
        return buildSingleQuery({
          data: { war_id: 'war-1', guild_code: 'ABC' }
        })
      }
      if (table === 'guild_war_zones') {
        return buildEqQuery({ data: [] })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/maps'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('returns map stats with computed rates', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' } })
      }
      if (table === 'guild_war_matches') {
        return buildSingleQuery({
          data: { war_id: 'war-1', guild_code: 'ABC' }
        })
      }
      if (table === 'guild_war_zones') {
        return buildEqQuery({
          data: [
            { id: 'zone-1', zone_type: 'Trenches1' },
            { id: 'zone-2', zone_type: 'ComsStation' }
          ]
        })
      }
      if (table === 'guild_war_battles') {
        return buildEqQuery({
          data: [
            {
              zone_id: 'zone-1',
              score_earned: 100,
              attempt_result: 'win',
              is_guild_member: true,
              defender_units_json: [{ remainingHPAfter: 0 }]
            },
            {
              zone_id: 'zone-1',
              score_earned: 50,
              attempt_result: 'loss',
              is_guild_member: true,
              defender_units_json: null
            },
            {
              zone_id: 'zone-1',
              score_earned: 40,
              attempt_result: 'win',
              is_guild_member: false,
              defender_units_json: []
            },
            {
              zone_id: 'zone-1',
              score_earned: 60,
              attempt_result: null,
              is_guild_member: false,
              defender_units_json: [{ remainingHPAfter: 12 }]
            }
          ]
        })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/maps'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0]).toEqual({
      zoneType: 'Trenches1',
      offense: { attacks: 2, wins: 1, winRate: 50, avgScore: 75 },
      defense: { defends: 2, holds: 1, holdRate: 50, avgScoreConceded: 50 }
    })
    expect(body[1]).toEqual({
      zoneType: 'ComsStation',
      offense: { attacks: 0, wins: 0, winRate: 0, avgScore: 0 },
      defense: { defends: 0, holds: 0, holdRate: 0, avgScoreConceded: 0 }
    })
  })

  it('aggregates two zone rows of the same type into ONE entry', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' } })
      }
      if (table === 'guild_war_matches') {
        return buildSingleQuery({
          data: { war_id: 'war-1', guild_code: 'ABC' }
        })
      }
      if (table === 'guild_war_zones') {
        // Two tiles, one zone_type: keying by zone.id would emit duplicate rows.
        return buildEqQuery({
          data: [
            { id: 'zone-1', zone_type: 'Trenches1' },
            { id: 'zone-2', zone_type: 'Trenches1' }
          ]
        })
      }
      if (table === 'guild_war_battles') {
        return buildEqQuery({
          data: [
            {
              zone_id: 'zone-1',
              score_earned: 100,
              attempt_result: 'win',
              is_guild_member: true,
              defender_units_json: [{ remainingHPAfter: 0 }]
            },
            {
              zone_id: 'zone-2',
              score_earned: 200,
              attempt_result: 'loss',
              is_guild_member: true,
              defender_units_json: null
            },
            {
              zone_id: 'zone-2',
              score_earned: 30,
              attempt_result: 'win',
              is_guild_member: false,
              defender_units_json: [{ remainingHPAfter: 5 }]
            }
          ]
        })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/maps'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body.map((m: { zoneType: string }) => m.zoneType)).toEqual([
      'Trenches1'
    ])
    expect(body[0]).toEqual({
      zoneType: 'Trenches1',
      offense: { attacks: 2, wins: 1, winRate: 50, avgScore: 150 },
      defense: { defends: 1, holds: 1, holdRate: 100, avgScoreConceded: 30 }
    })
  })

  it('uses defender HP truth over the attempt_result label', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' } })
      }
      if (table === 'guild_war_matches') {
        return buildSingleQuery({
          data: { war_id: 'war-1', guild_code: 'ABC' }
        })
      }
      if (table === 'guild_war_zones') {
        return buildEqQuery({
          data: [{ id: 'zone-1', zone_type: 'ComsStation' }]
        })
      }
      if (table === 'guild_war_battles') {
        return buildEqQuery({
          data: [
            {
              zone_id: 'zone-1',
              score_earned: 80,
              attempt_result: 'win',
              is_guild_member: true,
              defender_units_json: [
                { remainingHPAfter: 0 },
                { remainingHPAfter: '250' }
              ]
            },
            {
              zone_id: 'zone-1',
              score_earned: 120,
              attempt_result: 'fail',
              is_guild_member: true,
              defender_units_json: [
                { remainingHPAfter: 0 },
                { remainingHPAfter: '0' }
              ]
            },
            {
              zone_id: 'zone-1',
              score_earned: 10,
              attempt_result: 'loss',
              is_guild_member: true,
              defender_units_json: []
            },
            {
              // Label logic gives wins = 2, HP truth gives 1.
              zone_id: 'zone-1',
              score_earned: 40,
              attempt_result: 'win',
              is_guild_member: true,
              defender_units_json: [{ remainingHPAfter: 175 }]
            },
            {
              zone_id: 'zone-1',
              score_earned: 30,
              attempt_result: 'win',
              is_guild_member: false,
              defender_units_json: [{ remainingHPAfter: 42 }]
            },
            {
              zone_id: 'zone-1',
              score_earned: 90,
              attempt_result: 'fail',
              is_guild_member: false,
              defender_units_json: [{ remainingHPAfter: 0 }]
            },
            {
              zone_id: 'zone-1',
              score_earned: 50,
              attempt_result: 'win',
              is_guild_member: false,
              defender_units_json: [{ remainingHPAfter: 8 }]
            }
          ]
        })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/maps'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0]).toEqual({
      zoneType: 'ComsStation',
      offense: { attacks: 4, wins: 1, winRate: 25, avgScore: 63 },
      defense: { defends: 3, holds: 2, holdRate: 67, avgScoreConceded: 57 }
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockLogger: {
  error: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
}

type QueryResult = {
  data: Record<string, unknown>[] | null
  error: { message: string } | null
}

/** Zone/battle lookups terminate on `.eq`/`.not`, so the builder is thenable. */
const buildThenableQuery = (
  result: QueryResult,
  record: { column: string; value: unknown }[]
) => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      record.push({ column, value })
      return query
    }),
    not: vi.fn((column: string, operator: string, value: unknown) => {
      record.push({ column, value: `${operator}:${String(value)}` })
      return query
    }),
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected)
  }
  return query
}

describe('GET /api/wars/[warId]/players', () => {
  let GET: (
    request: NextRequest,
    context: { params: Promise<{ warId: string }> }
  ) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    rpc: ReturnType<typeof vi.fn>
  }

  const buildMaybeSingleQuery = (result: {
    data: Record<string, unknown> | null
    error: { message: string } | null
  }) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result)
  })

  const buildSingleQuery = (result: {
    data: Record<string, unknown> | null
    error: { message: string } | null
  }) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result)
  })

  let zoneFilters: { column: string; value: unknown }[]
  let battleFilters: { column: string; value: unknown }[]
  let tablesRead: string[]

  const configureAccess = (
    options: {
      membershipGuildCode?: string
      zones?: QueryResult
      battles?: QueryResult
    } = {}
  ) => {
    const {
      membershipGuildCode = 'ABC',
      zones = { data: [], error: null },
      battles = { data: [], error: null }
    } = options

    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      tablesRead.push(table)
      if (table === 'guild_war_matches') {
        return buildMaybeSingleQuery({
          data: { war_id: 'war-1', guild_code: 'ABC' },
          error: null
        })
      }
      if (table === 'player_mapping') {
        return buildSingleQuery({
          data: { guild_code: membershipGuildCode },
          error: null
        })
      }
      if (table === 'guild_war_zones') {
        return buildThenableQuery(zones, zoneFilters)
      }
      if (table === 'guild_war_battles') {
        return buildThenableQuery(battles, battleFilters)
      }
      throw new Error(`Unexpected table ${table}`)
    })
  }

  const attackerRow = (overrides: Record<string, unknown> = {}) => ({
    player_id: 'p1',
    player_name: 'Guildie',
    is_guild_member: true,
    total_attacks: 3,
    wins: 2,
    losses: 1,
    points: 120,
    perfect_hits: 1,
    failed_hits: 0,
    win_rate: 66.6,
    avg_score: 40,
    defended: 2,
    held: 1,
    breached: 1,
    conceded: 55,
    hold_rate: 50,
    ...overrides
  })

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    zoneFilters = []
    battleFilters = []
    tablesRead = []

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    }
    vi.doMock('@/app/lib/war/logger', () => ({ logger: mockLogger }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      rpc: vi.fn()
    }
    mockServiceSupabase = {
      rpc: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)

    const routeModule = await import('@/app/api/wars/[warId]/players/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when warId is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/wars//players'),
      { params: Promise.resolve({ warId: '' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe(2011)
  })

  it('returns 400 when side is invalid', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/players?side=invalid'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('side must be')
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/players'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe(1004)
  })

  it('returns 500 when war lookup fails', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_war_matches') {
        return buildMaybeSingleQuery({ data: null, error: { message: 'boom' } })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/players'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe(4002)
  })

  it('returns 404 when war is not found', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_war_matches') {
        return buildMaybeSingleQuery({ data: null, error: null })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/players'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.code).toBe(3001)
  })

  it('returns 403 when user does not belong to the war guild', async () => {
    configureAccess({ membershipGuildCode: 'OTHER' })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/players'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe(1005)
    expect(tablesRead).not.toContain('guild_war_zones')
    expect(tablesRead).not.toContain('guild_war_battles')
  })

  it('returns 500 when player stats RPC fails', async () => {
    configureAccess()
    mockServiceSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'boom' }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/players'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe(4002)
  })

  it('returns filtered player stats for opponent side', async () => {
    configureAccess()
    mockServiceSupabase.rpc.mockResolvedValue({
      data: [
        attackerRow(),
        {
          player_id: 'p2',
          player_name: 'Opponent',
          is_guild_member: false,
          total_attacks: '4',
          wins: '1',
          losses: '3',
          points: '90',
          perfect_hits: '0',
          failed_hits: '1',
          win_rate: '25',
          avg_score: '22.5',
          defended: '5',
          held: '3',
          breached: '2',
          conceded: '87.5',
          hold_rate: '60'
        }
      ],
      error: null
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/players?side=opponent'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0].playerId).toBe('p2')
    expect(body[0].attacks.total).toBe(4)
    expect(body[0].attacks.avgScore).toBe(22.5)
    expect(body[0].defenses).toEqual({
      total: 5,
      holds: 3,
      breaches: 2,
      conceded: 87.5,
      holdRate: 60
    })
  })

  it('maps real defensive stats for guild side, including defense-only players', async () => {
    configureAccess()
    mockServiceSupabase.rpc.mockResolvedValue({
      data: [
        attackerRow({
          player_name: 'Attacker And Defender',
          defended: 4,
          held: 3,
          breached: 1,
          conceded: 42.5,
          hold_rate: 75
        }),
        {
          player_id: 'p3',
          player_name: 'Pure Defender',
          is_guild_member: true,
          total_attacks: 0,
          wins: 0,
          losses: 0,
          points: 0,
          perfect_hits: 0,
          failed_hits: 0,
          win_rate: 0,
          avg_score: 0,
          defended: 2,
          held: 2,
          breached: 0,
          conceded: 0,
          hold_rate: 100
        },
        {
          // Older RPC shape without defensive columns must degrade to zeros.
          player_id: 'p4',
          player_name: 'Legacy Row',
          is_guild_member: true,
          total_attacks: 1,
          wins: 1,
          losses: 0,
          points: 30,
          perfect_hits: 0,
          failed_hits: 0,
          win_rate: 100,
          avg_score: 30
        }
      ],
      error: null
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/players?side=guild'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(3)
    expect(body[0].defenses).toEqual({
      total: 4,
      holds: 3,
      breaches: 1,
      conceded: 42.5,
      holdRate: 75
    })
    expect(body[1].playerId).toBe('p3')
    expect(body[1].attacks.total).toBe(0)
    expect(body[1].defenses).toEqual({
      total: 2,
      holds: 2,
      breaches: 0,
      conceded: 0,
      holdRate: 100
    })
    expect(body[2].playerId).toBe('p4')
    expect(body[2].defenses).toEqual({
      total: 0,
      holds: 0,
      breaches: 0,
      conceded: 0,
      holdRate: 0
    })
  })

  describe('assignedZoneType derivation', () => {
    it('scopes both zone reads to the war and the access-checked guild code', async () => {
      configureAccess()
      mockServiceSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const response = await GET(
        new NextRequest('http://localhost/api/wars/war-1/players'),
        { params: Promise.resolve({ warId: 'war-1' }) }
      )

      expect(response.status).toBe(200)
      expect(tablesRead).toContain('guild_war_zones')
      expect(tablesRead).toContain('guild_war_battles')
      expect(mockServiceSupabase).not.toHaveProperty('from')
      expect(zoneFilters).toEqual([
        { column: 'war_id', value: 'war-1' },
        { column: 'guild_code', value: 'ABC' }
      ])
      expect(battleFilters).toEqual([
        { column: 'war_id', value: 'war-1' },
        { column: 'guild_code', value: 'ABC' },
        { column: 'defender_player_id', value: 'is:null' }
      ])
    })

    it('assigns the modal zone of a player defense battles', async () => {
      configureAccess({
        zones: {
          data: [
            { id: 'z1', zone_type: 'FRONT_LINE', assigned_players: null },
            { id: 'z2', zone_type: 'BASTION', assigned_players: null }
          ],
          error: null
        },
        battles: {
          data: [
            { defender_player_id: 'p1', zone_id: 'z2' },
            { defender_player_id: 'p1', zone_id: 'z1' },
            { defender_player_id: 'p1', zone_id: 'z1' }
          ],
          error: null
        }
      })
      mockServiceSupabase.rpc.mockResolvedValue({
        data: [attackerRow()],
        error: null
      })

      const response = await GET(
        new NextRequest('http://localhost/api/wars/war-1/players'),
        { params: Promise.resolve({ warId: 'war-1' }) }
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body[0].assignedZoneType).toBe('FRONT_LINE')
    })

    it('breaks a modal count tie by zone_type ascending', async () => {
      configureAccess({
        zones: {
          data: [
            { id: 'zA', zone_type: 'BASTION', assigned_players: null },
            { id: 'zB', zone_type: 'ARMORY', assigned_players: null }
          ],
          error: null
        },
        battles: {
          data: [
            { defender_player_id: 'p1', zone_id: 'zA' },
            { defender_player_id: 'p1', zone_id: 'zB' }
          ],
          error: null
        }
      })
      mockServiceSupabase.rpc.mockResolvedValue({
        data: [attackerRow()],
        error: null
      })

      const response = await GET(
        new NextRequest('http://localhost/api/wars/war-1/players'),
        { params: Promise.resolve({ warId: 'war-1' }) }
      )
      const body = await response.json()

      expect(body[0].assignedZoneType).toBe('ARMORY')
    })

    it('falls back to the zone-planning assignment matched by display name', async () => {
      configureAccess({
        zones: {
          data: [
            {
              id: 'z1',
              zone_type: 'FRONT_LINE',
              assigned_players: ['Planned Player']
            },
            {
              id: 'z2',
              zone_type: 'BASTION',
              assigned_players: ['Planned Player']
            }
          ],
          error: null
        },
        battles: { data: [], error: null }
      })
      mockServiceSupabase.rpc.mockResolvedValue({
        data: [attackerRow({ player_id: 'p9', player_name: 'Planned Player' })],
        error: null
      })

      const response = await GET(
        new NextRequest('http://localhost/api/wars/war-1/players'),
        { params: Promise.resolve({ warId: 'war-1' }) }
      )
      const body = await response.json()

      expect(body[0].assignedZoneType).toBe('FRONT_LINE')
    })

    it('never applies the planning fallback to opponent rows with a colliding display name', async () => {
      // Same name on both sides: the opponent must not inherit our planning row.
      configureAccess({
        zones: {
          data: [
            {
              id: 'z1',
              zone_type: 'FRONT_LINE',
              assigned_players: ['Shared Name']
            }
          ],
          error: null
        },
        battles: { data: [], error: null }
      })
      mockServiceSupabase.rpc.mockResolvedValue({
        data: [
          attackerRow({
            player_id: 'ours',
            player_name: 'Shared Name',
            is_guild_member: true
          }),
          attackerRow({
            player_id: 'theirs',
            player_name: 'Shared Name',
            is_guild_member: false
          }),
          attackerRow({
            player_id: 'theirs-unknown',
            player_name: 'Shared Name',
            is_guild_member: null
          })
        ],
        error: null
      })

      const opponentBody = await (
        await GET(
          new NextRequest(
            'http://localhost/api/wars/war-1/players?side=opponent'
          ),
          { params: Promise.resolve({ warId: 'war-1' }) }
        )
      ).json()

      expect(opponentBody).toHaveLength(2)
      expect(opponentBody[0].playerId).toBe('theirs')
      expect(opponentBody[0].assignedZoneType).toBeUndefined()
      expect(opponentBody[1].playerId).toBe('theirs-unknown')
      expect(opponentBody[1].assignedZoneType).toBeUndefined()

      const guildBody = await (
        await GET(
          new NextRequest('http://localhost/api/wars/war-1/players?side=guild'),
          { params: Promise.resolve({ warId: 'war-1' }) }
        )
      ).json()

      expect(guildBody).toHaveLength(1)
      expect(guildBody[0].playerId).toBe('ours')
      expect(guildBody[0].assignedZoneType).toBe('FRONT_LINE')
    })

    it('still derives an opponent zone from their own defense battles', async () => {
      configureAccess({
        zones: {
          data: [
            { id: 'z1', zone_type: 'BASTION', assigned_players: ['Opponent'] }
          ],
          error: null
        },
        battles: {
          data: [{ defender_player_id: 'p2', zone_id: 'z1' }],
          error: null
        }
      })
      mockServiceSupabase.rpc.mockResolvedValue({
        data: [
          attackerRow({
            player_id: 'p2',
            player_name: 'Opponent',
            is_guild_member: false
          })
        ],
        error: null
      })

      const response = await GET(
        new NextRequest(
          'http://localhost/api/wars/war-1/players?side=opponent'
        ),
        { params: Promise.resolve({ warId: 'war-1' }) }
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body[0].assignedZoneType).toBe('BASTION')
    })

    it('prefers the defended zone over the planning assignment', async () => {
      configureAccess({
        zones: {
          data: [
            {
              id: 'z1',
              zone_type: 'FRONT_LINE',
              assigned_players: ['Guildie']
            },
            { id: 'z2', zone_type: 'BASTION', assigned_players: [] }
          ],
          error: null
        },
        battles: {
          data: [{ defender_player_id: 'p1', zone_id: 'z2' }],
          error: null
        }
      })
      mockServiceSupabase.rpc.mockResolvedValue({
        data: [attackerRow()],
        error: null
      })

      const response = await GET(
        new NextRequest('http://localhost/api/wars/war-1/players'),
        { params: Promise.resolve({ warId: 'war-1' }) }
      )
      const body = await response.json()

      expect(body[0].assignedZoneType).toBe('BASTION')
    })

    it('leaves attack-only players unset so the client renders a dash', async () => {
      configureAccess({
        zones: {
          data: [
            {
              id: 'z1',
              zone_type: 'FRONT_LINE',
              assigned_players: ['Someone Else']
            },
            { id: 'z2', zone_type: null, assigned_players: ['Guildie'] }
          ],
          error: null
        },
        battles: {
          data: [{ defender_player_id: 'p1', zone_id: 'z-unknown' }],
          error: null
        }
      })
      mockServiceSupabase.rpc.mockResolvedValue({
        data: [attackerRow()],
        error: null
      })

      const response = await GET(
        new NextRequest('http://localhost/api/wars/war-1/players'),
        { params: Promise.resolve({ warId: 'war-1' }) }
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body[0].assignedZoneType).toBeUndefined()
      expect(body[0]).not.toHaveProperty('assignedZoneType')
    })

    it('degrades to unset zones and still returns 200 when the zone reads fail', async () => {
      configureAccess({
        zones: { data: null, error: { message: 'zones boom' } },
        battles: { data: [], error: null }
      })
      mockServiceSupabase.rpc.mockResolvedValue({
        data: [attackerRow()],
        error: null
      })

      const response = await GET(
        new NextRequest('http://localhost/api/wars/war-1/players'),
        { params: Promise.resolve({ warId: 'war-1' }) }
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0].assignedZoneType).toBeUndefined()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to load zone data for player stats',
        expect.objectContaining({
          warId: 'war-1',
          zonesError: { message: 'zones boom' }
        })
      )
    })
  })
})

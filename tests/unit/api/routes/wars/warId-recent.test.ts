import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockGuildConfigGetBasic: ReturnType<typeof vi.fn>

describe('GET /api/wars/[warId]/recent', () => {
  let GET: (
    request: NextRequest,
    context: { params: Promise<{ warId: string }> }
  ) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
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

  const buildBattleQuery = (result: {
    data: Array<Record<string, unknown>> | null
    error: { message: string } | null
  }) => {
    const query: {
      select: ReturnType<typeof vi.fn>
      eq: ReturnType<typeof vi.fn>
      order: ReturnType<typeof vi.fn>
      lt: ReturnType<typeof vi.fn>
      limit: ReturnType<typeof vi.fn>
      then: (resolve: (value: typeof result) => void) => void
    } = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => query),
      then: (resolve) => resolve(result)
    }
    return query
  }

  const buildZonesQuery = (result: {
    data: Array<Record<string, unknown>> | null
    error: { message: string } | null
  }) => ({
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue(result)
  })

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockGuildConfigGetBasic = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getBasic: mockGuildConfigGetBasic
      }
    }))

    vi.doMock('@/modules/guild-war/server/logger', () => ({
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/wars/[warId]/recent/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns 400 when warId is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/recent'),
      { params: Promise.resolve({ warId: '' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe(2011)
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/recent'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe(1004)
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
      new NextRequest('http://localhost/api/wars/war-1/recent'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.code).toBe(3001)
  })

  it('returns 403 when user does not belong to the war guild', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_war_matches') {
        return buildMaybeSingleQuery({
          data: { war_id: 'war-1', guild_code: 'ABC' },
          error: null
        })
      }
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'OTHER' }, error: null })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/recent'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe(1005)
  })

  it('applies cursor filtering and default limit', async () => {
    const battleQuery = buildBattleQuery({ data: [], error: null })
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockGuildConfigGetBasic.mockResolvedValue({ display_name: 'Alpha Guild' })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_war_matches') {
        return buildMaybeSingleQuery({
          data: { war_id: 'war-1', guild_code: 'ABC' },
          error: null
        })
      }
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' }, error: null })
      }
      if (table === 'guild_war_battles') {
        return battleQuery
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/wars/war-1/recent?cursor=2026-01-01T00:00:00.000Z'
      ),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(battleQuery.lt).toHaveBeenCalledWith(
      'attempt_end_time',
      '2026-01-01T00:00:00.000Z'
    )
    expect(battleQuery.limit).toHaveBeenCalledWith(51)
    expect(body.attempts).toEqual([])
  })

  it('returns activity items with pagination and RAW zone types', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'))

    const battleQuery = buildBattleQuery({
      data: [
        {
          id: 'b1',
          attacker_player_name: 'Alpha',
          attacker_guild_name: 'Alpha Guild',
          defender_player_name: 'Omega',
          defender_guild_name: 'Opponents',
          score_earned: 50,
          attempt_debuff: 2,
          attempt_end_time: '2026-01-01T23:59:00.000Z',
          attempt_result: null,
          attacker_units_json: [{ slotIndex: 0, displayName: 'Hero One' }],
          defender_units_json: null,
          zone_id: 'zone-1',
          kill_count: null,
          perfect_hit: null,
          is_guild_member: true
        },
        {
          id: 'b2',
          attacker_player_name: null,
          attacker_guild_name: null,
          defender_player_name: null,
          defender_guild_name: null,
          score_earned: null,
          attempt_debuff: 1,
          attempt_end_time: '2026-01-01T23:58:00.000Z',
          attempt_result: null,
          attacker_units_json: 'oops',
          defender_units_json: [],
          zone_id: 'zone-2',
          kill_count: null,
          perfect_hit: null,
          is_guild_member: false
        },
        {
          id: 'b3',
          attacker_player_name: 'Extra',
          attacker_guild_name: 'Alpha Guild',
          defender_player_name: 'Extra',
          defender_guild_name: 'Opponents',
          score_earned: 10,
          attempt_debuff: null,
          attempt_end_time: '2026-01-01T23:57:00.000Z',
          attempt_result: null,
          attacker_units_json: [],
          defender_units_json: [],
          zone_id: 'zone-1',
          kill_count: null,
          perfect_hit: null,
          is_guild_member: true
        }
      ],
      error: null
    })

    // Misleading legacy zone_name values break the raw-zoneType asserts if read.
    const zonesQuery = buildZonesQuery({
      data: [
        { id: 'zone-1', zone_name: 'Frontline', zone_type: 'Trenches1' },
        { id: 'zone-2', zone_name: 'Comms Station', zone_type: 'ComsStation' }
      ],
      error: null
    })

    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockGuildConfigGetBasic.mockResolvedValue({ display_name: 'Alpha Guild' })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_war_matches') {
        return buildMaybeSingleQuery({
          data: {
            war_id: 'war-1',
            guild_code: 'ABC',
            opponent_guild_name: 'Opponents',
            guild_score: 10,
            opponent_score: 5,
            war_result: 'win'
          },
          error: null
        })
      }
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' }, error: null })
      }
      if (table === 'guild_war_battles') {
        return battleQuery
      }
      if (table === 'guild_war_zones') {
        return zonesQuery
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/recent?limit=2'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(battleQuery.limit).toHaveBeenCalledWith(3)

    const zonesSelect = zonesQuery.select.mock.calls[0]?.[0] as string
    expect(zonesSelect).toContain('zone_type')
    expect(zonesSelect).not.toContain('zone_name')

    expect(body.attempts).toHaveLength(2)
    // zoneDisplayName is not idempotent, so ActivityTable formats it exactly once.
    expect(body.attempts[0]).toMatchObject({
      id: 'b1',
      zoneType: 'Trenches1',
      score: 50,
      buffLevel: 2
    })
    expect(body.attempts[1]).toMatchObject({
      id: 'b2',
      zoneType: 'ComsStation',
      score: 0,
      buffLevel: 1
    })
    expect(body.attempts[0]).not.toHaveProperty('zoneName')
    expect(body.attempts[1]).not.toHaveProperty('zoneName')
    expect(JSON.stringify(body.attempts)).not.toContain('Vox-Station')
    expect(body.attempts[1].attackerUnits).toEqual([])
    expect(body.nextCursor).toBe('2026-01-01T23:58:00.000Z')
    expect(body.warTitle).toBe('Alpha Guild v Opponents')
    expect(body.viewerGuildName).toBe('Alpha Guild')
    expect(body.opponentGuildName).toBe('Opponents')
  })
})

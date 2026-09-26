import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>

describe('GET /api/wars/[warId]', () => {
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

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@/modules/guild-war/server/logger', () => ({
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/wars/[warId]/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when warId is missing', async () => {
    const response = await GET(new NextRequest('http://localhost/api/wars/'), {
      params: Promise.resolve({ warId: '' })
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe(2011)
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1'),
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
      new NextRequest('http://localhost/api/wars/war-1'),
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
      new NextRequest('http://localhost/api/wars/war-1'),
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
      new NextRequest('http://localhost/api/wars/war-1'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe(1005)
  })

  it('returns war details for authorized users', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_war_matches') {
        return buildMaybeSingleQuery({
          data: {
            war_id: 'war-1',
            guild_code: 'ABC',
            opponent_guild_name: 'Opponents',
            opponent_guild_code: 'OPP',
            war_status: 'active',
            guild_score: 10,
            opponent_score: 6,
            war_start_date: '2026-01-01T00:00:00.000Z',
            war_end_date: '2026-01-02T00:00:00.000Z',
            war_result: 'win',
            battlefield_level: 3,
            war_season: 2
          },
          error: null
        })
      }
      if (table === 'player_mapping') {
        return buildSingleQuery({ data: { guild_code: 'ABC' }, error: null })
      }
      if (table === 'guild_config') {
        return buildMaybeSingleQuery({
          data: { display_name: 'Alpha Guild' },
          error: null
        })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.warId).toBe('war-1')
    expect(body.guild.guildName).toBe('Alpha Guild')
    expect(body.status).toBe('in_progress')
    expect(body.opponent.guildTag).toBe('OPP')
    expect(body.warSlug).toBe('abc-vs-opp')
  })
})

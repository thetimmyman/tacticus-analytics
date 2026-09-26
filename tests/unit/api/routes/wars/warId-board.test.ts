import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>

describe('GET /api/wars/[warId]/board', () => {
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

  const buildListQuery = (result: {
    data: Array<Record<string, unknown>> | null
    error: { message: string } | null
  }) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn()
    }
    query.eq.mockImplementation(() => ({
      eq: vi.fn().mockResolvedValue(result)
    }))
    return query
  }

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

    const routeModule = await import('@/app/api/wars/[warId]/board/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/board'),
      {
        params: Promise.resolve({ warId: 'war-1' })
      }
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe(1004)
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
      new NextRequest('http://localhost/api/wars/war-1/board'),
      {
        params: Promise.resolve({ warId: 'war-1' })
      }
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe(1005)
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
      new NextRequest('http://localhost/api/wars/war-1/board'),
      {
        params: Promise.resolve({ warId: 'war-1' })
      }
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.code).toBe(3001)
  })

  it('returns board sides for authorized users', async () => {
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
        return buildSingleQuery({ data: { guild_code: 'ABC' }, error: null })
      }
      if (table === 'guild_war_battles') {
        return buildListQuery({
          data: [
            {
              attacker_player_id: 'p1',
              attacker_player_name: 'Alpha',
              defender_player_id: 'p2',
              defender_player_name: 'Beta',
              is_guild_member: true,
              score_earned: 100
            }
          ],
          error: null
        })
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/board'),
      {
        params: Promise.resolve({ warId: 'war-1' })
      }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    // Exact aggregation is buildBoardSides' own concern.
    expect(body).toHaveProperty('guild')
    expect(body).toHaveProperty('opponent')
  })
})

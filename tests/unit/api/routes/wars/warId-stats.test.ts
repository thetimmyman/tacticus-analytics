import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('GET /api/wars/[warId]/stats', () => {
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
    data: unknown
    error: unknown
  }) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result)
  })

  const buildSingleQuery = (result: { data: unknown; error: unknown }) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result)
  })

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/modules/guild-war/server/logger', () => ({
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    }))

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

    const routeModule = await import('@/app/api/wars/[warId]/stats/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when warId is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/stats'),
      { params: Promise.resolve({ warId: '' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe(2011)
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/stats'),
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
      new NextRequest('http://localhost/api/wars/war-1/stats'),
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
      new NextRequest('http://localhost/api/wars/war-1/stats'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe(1005)
  })

  it('returns 500 when stats RPC fails', async () => {
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
      return { select: vi.fn().mockReturnThis() }
    })
    mockServiceSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'boom' }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/stats'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe(4002)
  })

  it('returns empty stats when no data is available', async () => {
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
      return { select: vi.fn().mockReturnThis() }
    })
    mockServiceSupabase.rpc.mockResolvedValue({ data: [], error: null })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/stats'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ourAttacks).toBe(0)
    expect(body.theirAttacks).toBe(0)
    expect(body.avgScore).toBe(0)
  })

  it('normalizes war stat values from RPC', async () => {
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
      return { select: vi.fn().mockReturnThis() }
    })
    mockServiceSupabase.rpc.mockResolvedValue({
      data: [
        {
          our_attacks: '2',
          their_attacks: 3,
          perfect_hits: '1',
          failed_hits: '0',
          our_wins: 1,
          their_wins: 0,
          our_points: 150,
          their_points: 120,
          win_rate: '66.7',
          hold_rate: '50',
          avg_score: '123.4'
        }
      ],
      error: null
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/war-1/stats'),
      { params: Promise.resolve({ warId: 'war-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ourAttacks).toBe(2)
    expect(body.theirAttacks).toBe(3)
    expect(body.perfectHits).toBe(1)
    expect(body.failedHits).toBe(0)
    expect(body.winRate).toBe(66.7)
    expect(body.avgScore).toBe(123.4)
  })
})

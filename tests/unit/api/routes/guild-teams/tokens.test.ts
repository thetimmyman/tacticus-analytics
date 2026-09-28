import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hover serves the token projection, never the legacy 3/1 estimate; the loader returns legacy
// rows (no throw) when its guard fails, so the route must pass a resolved season or skip it.

type QueryResponse = {
  data: Array<Record<string, unknown>> | Record<string, unknown> | null
  error: { message: string } | null
}

function thenableQuery(response: QueryResponse) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (
      resolve: (value: QueryResponse) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(response).then(resolve, reject)
  }
  return query
}

function buildSupabase(players: Array<Record<string, unknown>>) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'player_mapping') {
        return thenableQuery({ data: players, error: null })
      }
      return thenableQuery({ data: null, error: null })
    })
  }
}

const KEYED = {
  player_id: 'KEYED',
  display_name: 'Keyed',
  last_sync_tokens: 3,
  last_sync_bombs: 1,
  next_token_seconds: 100,
  next_bomb_seconds: 200,
  last_sync_at: '2026-07-17T00:00:00Z'
}
const NOPROJ = {
  player_id: 'NOPROJ',
  display_name: 'NoProj',
  last_sync_tokens: 2,
  last_sync_bombs: 0,
  next_token_seconds: 300,
  next_bomb_seconds: 400,
  last_sync_at: null
}

describe('GET /api/guild-teams/tokens — projection', () => {
  let GET: (request: Request) => Promise<Response>
  let mockServiceDb: ReturnType<typeof vi.fn>
  let mockRequireAccess: ReturnType<typeof vi.fn>
  let mockLoadGuildTokenStatuses: ReturnType<typeof vi.fn>
  let mockGetLatestSeason: ReturnType<typeof vi.fn>

  const loadRoute = async () => {
    const mod = await import('@/app/api/guild-teams/tokens/route')
    GET = mod.GET as unknown as (request: Request) => Promise<Response>
  }

  const request = () =>
    new Request('http://localhost/api/guild-teams/tokens?guild=EOT')

  beforeEach(() => {
    vi.resetModules()

    mockServiceDb = vi.fn()
    mockRequireAccess = vi
      .fn()
      .mockResolvedValue({ guild: 'EOT', clusterCode: null })
    mockLoadGuildTokenStatuses = vi
      .fn()
      .mockResolvedValue({ players: [], debug: {} })
    mockGetLatestSeason = vi.fn().mockResolvedValue('105')

    vi.doMock('@/app/lib/db', () => ({ serviceDb: mockServiceDb }))
    vi.doMock('@/app/api/members/token-usage/access', () => ({
      requireTokenUsageGuildAccess: mockRequireAccess
    }))
    vi.doMock('@/app/api/guild-tokens/token-service', () => ({
      loadGuildTokenStatuses: mockLoadGuildTokenStatuses
    }))
    vi.doMock('@/app/lib/data/get-latest-season', () => ({
      getLatestSeason: mockGetLatestSeason
    }))
    vi.doMock('@/app/lib/middleware/errorHandler', () => ({
      withErrorHandler: (handler: (request: Request) => Promise<Response>) =>
        handler
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      })
    }))
  })

  it('serves the projected on-hand for a key-holder and falls back to the raw snapshot for a member with no projection row', async () => {
    mockServiceDb.mockReturnValue(buildSupabase([KEYED, NOPROJ]))
    // Projection says 1 banked token (the stale raw snapshot says 3); no row for NOPROJ.
    mockLoadGuildTokenStatuses.mockResolvedValue({
      players: [
        {
          player_id: 'KEYED',
          tokens_available: 1,
          bombs_available: 0,
          token_next_in_seconds: 4321,
          next_bomb_seconds: 5555
        }
      ],
      debug: {}
    })

    await loadRoute()
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<Record<string, unknown>>

    // A null season would risk the legacy 3/1 clobber.
    expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        guildCode: 'EOT',
        season: '105',
        skipLiveOverlay: true
      })
    )
    expect(mockLoadGuildTokenStatuses).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ season: null, skipLiveOverlay: true })
    )

    const keyed = body.find((r) => r.player_id === 'KEYED')
    expect(keyed).toMatchObject({
      tokens_available: 1,
      token_next_in_seconds: 4321,
      bombs_available_live: 0,
      bomb_next_in_seconds: 5555,
      bombs_used: null
    })

    const noProj = body.find((r) => r.player_id === 'NOPROJ')
    expect(noProj).toMatchObject({
      tokens_available: 2,
      token_next_in_seconds: 300,
      bombs_available_live: 0,
      bomb_next_in_seconds: 400
    })
  })

  it('keeps the raw cached snapshot for every member when the projection resolves EMPTY (guild has no rows this season — the regression case)', async () => {
    mockServiceDb.mockReturnValue(buildSupabase([KEYED, NOPROJ]))
    // Members keep their raw snapshot.
    mockLoadGuildTokenStatuses.mockResolvedValue({ players: [], debug: {} })

    await loadRoute()
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<Record<string, unknown>>

    const keyed = body.find((r) => r.player_id === 'KEYED')
    expect(keyed).toMatchObject({
      tokens_available: 3,
      token_next_in_seconds: 100,
      bombs_available_live: 1,
      bomb_next_in_seconds: 200
    })
    const noProj = body.find((r) => r.player_id === 'NOPROJ')
    expect(noProj).toMatchObject({
      tokens_available: 2,
      token_next_in_seconds: 300,
      bombs_available_live: 0,
      bomb_next_in_seconds: 400
    })
  })

  it('skips the projection entirely (raw snapshot kept) when the season cannot be resolved', async () => {
    mockServiceDb.mockReturnValue(buildSupabase([KEYED]))
    mockGetLatestSeason.mockResolvedValue(null)

    await loadRoute()
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<Record<string, unknown>>

    expect(mockLoadGuildTokenStatuses).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipLiveOverlay: true })
    )

    const keyed = body.find((r) => r.player_id === 'KEYED')
    expect(keyed).toMatchObject({
      tokens_available: 3,
      token_next_in_seconds: 100,
      bombs_available_live: 1,
      bomb_next_in_seconds: 200
    })
  })

  it('falls back to the cached snapshot values when the projection throws a hard error', async () => {
    mockServiceDb.mockReturnValue(buildSupabase([KEYED]))
    mockLoadGuildTokenStatuses.mockRejectedValue(new Error('rpc down'))

    await loadRoute()
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<Record<string, unknown>>

    const keyed = body.find((r) => r.player_id === 'KEYED')
    expect(keyed).toMatchObject({
      tokens_available: 3,
      token_next_in_seconds: 100,
      bombs_available_live: 1,
      bomb_next_in_seconds: 200
    })
  })
})

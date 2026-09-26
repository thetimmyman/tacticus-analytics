import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

// The data contract is pinned by app/api/meta-analysis/recommendations/route.test.ts.

let mockCreateClient: ReturnType<typeof vi.fn>
let mockFetchMetaAtlasSeasonRows: ReturnType<typeof vi.fn>

const createNextRequest = (url: string) => {
  const urlObj = new URL(url)
  return {
    nextUrl: { searchParams: urlObj.searchParams }
  } as unknown as Request
}

const baseUrl =
  'http://localhost/api/meta-analysis/recommendations?season=45&rarity=Mythic'

type ScopeRow = {
  guild_code: string | null
  cluster_code?: string | null
}
type QueryResult = {
  data: ScopeRow | null
  error: { message: string } | null
}
type ScopeFixture = {
  membership: QueryResult
  ownGuild: QueryResult
  requestedGuilds: Record<string, QueryResult>
}

const atlasRow = {
  team_hash: 'hash-1',
  team_composition: 'Hero1, Hero2 + MOW1',
  meta_team: 'Ultramarines',
  boss_type: 'SilentKing',
  boss_unit_id: null,
  sub_boss_name: 'Hive Tyrant',
  encounter_index: 0,
  encounter_type: 'Boss',
  rarity: 'Mythic',
  set_num: 0,
  rarity_set: 'M1',
  season: '45',
  attack_count: 100,
  damage_max: 600000,
  damage_p90: 500000,
  damage_p75: 470000,
  damage_avg: 450000,
  damage_stddev: 50000,
  coef_variation: 15,
  damage_min: 300000,
  distinct_players: 10,
  distinct_guilds: 5
}

type RecommendationTeams = Array<{
  rarity: string
  set: number
  levelString: string
  bossName: string
  rank: number
  composition: { compositionKey: string }
}>

/** The scope must reach the rendering client. */
type RecommendationBody = {
  scope: string
  requestedGuildFilter: string | null
  guildFilterIgnored: boolean
  data: RecommendationTeams
}

const gridRows = () => {
  const rows: Array<typeof atlasRow> = []
  for (let set = 0; set <= 4; set += 1) {
    for (let encounter = 0; encounter <= 2; encounter += 1) {
      rows.push({
        ...atlasRow,
        team_hash: `cell-${set}-${encounter}`,
        set_num: set,
        encounter_index: encounter
      })
    }
  }
  return rows
}

describe('GET /api/meta-analysis/recommendations', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let queryLog: Array<{ table: string; filters: Record<string, unknown> }>

  const installScope = (overrides: Partial<ScopeFixture> = {}) => {
    const fixture: ScopeFixture = {
      membership: {
        data: { guild_code: 'OWN' },
        error: null
      },
      ownGuild: {
        data: { guild_code: 'OWN', cluster_code: 'EOT' },
        error: null
      },
      requestedGuilds: {},
      ...overrides
    }

    queryLog = []
    mockSupabase.from.mockImplementation((table: string) => {
      const entry = { table, filters: {} as Record<string, unknown> }
      queryLog.push(entry)

      const resolve = (): QueryResult => {
        if (table === 'player_mapping') return fixture.membership
        if (table !== 'guild_config') {
          return { data: null, error: { message: 'unexpected table' } }
        }
        const guildCode = String(entry.filters.guild_code ?? '')
        if (guildCode === 'OWN') return fixture.ownGuild
        return (
          fixture.requestedGuilds[guildCode] ?? {
            data: null,
            error: null
          }
        )
      }

      const builder: {
        select: ReturnType<typeof vi.fn>
        eq: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      } = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn()
      }
      builder.select.mockReturnValue(builder)
      builder.eq.mockImplementation(
        (column: string, value: string | boolean) => {
          entry.filters[column] = value
          return builder
        }
      )
      builder.maybeSingle.mockImplementation(async () => resolve())
      return builder
    })
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockFetchMetaAtlasSeasonRows = vi.fn().mockResolvedValue([atlasRow])

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))
    vi.doMock('@/app/lib/logging', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/logging')>(
          '@/app/lib/logging'
        )
      return {
        ...actual,
        createComponentLogger: () => ({
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn()
        }),
        logError: vi.fn()
      }
    })
    vi.doMock('@/app/lib/meta/meta-atlas-compositions', async () => {
      const actual = await vi.importActual<
        typeof import('@/app/lib/meta/meta-atlas-compositions')
      >('@/app/lib/meta/meta-atlas-compositions')
      return {
        ...actual,
        fetchMetaAtlasSeasonRows: mockFetchMetaAtlasSeasonRows
      }
    })

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      rpc: vi.fn()
    }
    mockCreateClient.mockResolvedValue(mockSupabase)
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null
    })
    installScope()

    const routeModule =
      await import('@/app/api/meta-analysis/recommendations/route')
    GET = routeModule.GET
  })

  it('validates season and marks the denial private', async () => {
    const response = await GET(
      createNextRequest('http://localhost/api/meta-analysis/recommendations')
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockFetchMetaAtlasSeasonRows).not.toHaveBeenCalled()
  })

  it('returns 401 before scope or aggregate work when authentication is missing', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null
    })

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(mockFetchMetaAtlasSeasonRows).not.toHaveBeenCalled()
  })

  it.each([
    [
      'membership lookup error',
      {
        membership: { data: null, error: { message: 'mapping failed' } }
      }
    ],
    ['missing current membership', { membership: { data: null, error: null } }],
    [
      'current membership without a guild',
      { membership: { data: { guild_code: null }, error: null } }
    ],
    [
      'missing mapped guild',
      { ownGuild: { data: null, error: { message: 'guild missing' } } }
    ]
  ])('denies %s before the aggregate fetch', async (_label, overrides) => {
    installScope(overrides as Partial<ScopeFixture>)

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockFetchMetaAtlasSeasonRows).not.toHaveBeenCalled()
  })

  it('denies a cross-cluster guild filter before the aggregate fetch', async () => {
    installScope({
      requestedGuilds: {
        OUTSIDE: {
          data: { guild_code: 'OUTSIDE', cluster_code: 'OTHER' },
          error: null
        }
      }
    })

    const response = await GET(
      createNextRequest(`${baseUrl}&guildFilter=OUTSIDE`)
    )

    expect(response.status).toBe(403)
    expect(mockFetchMetaAtlasSeasonRows).not.toHaveBeenCalled()
  })

  it('issues exactly one season-wide fetch and never fans out per guild', async () => {
    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(200)
    expect(mockFetchMetaAtlasSeasonRows).toHaveBeenCalledTimes(1)
    expect(mockFetchMetaAtlasSeasonRows).toHaveBeenCalledWith(
      mockSupabase,
      '45'
    )
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
    expect(response.headers.get('x-meta-scope')).toBe('global')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(
      queryLog.find((query) => query.table === 'player_mapping')?.filters
    ).toEqual({
      user_id: 'user-123',
      is_current: true
    })
  })

  it('admits an own-guild filter through the real gate without scoping the data', async () => {
    const response = await GET(createNextRequest(`${baseUrl}&guildFilter=OWN`))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-meta-guild-filter-ignored')).toBe('true')
    expect(mockFetchMetaAtlasSeasonRows).toHaveBeenCalledWith(
      mockSupabase,
      '45'
    )
  })

  it('admits a server-verified same-cluster guild filter', async () => {
    installScope({
      requestedGuilds: {
        ALLY: {
          data: { guild_code: 'ALLY', cluster_code: 'EOT' },
          error: null
        }
      }
    })

    const response = await GET(createNextRequest(`${baseUrl}&guildFilter=ALLY`))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-meta-guild-filter-ignored')).toBe('true')
    expect(mockFetchMetaAtlasSeasonRows).toHaveBeenCalledTimes(1)
  })

  it('admits an independent member with no cluster', async () => {
    installScope({
      ownGuild: {
        data: { guild_code: 'OWN', cluster_code: null },
        error: null
      }
    })

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(200)
    expect(mockFetchMetaAtlasSeasonRows).toHaveBeenCalledTimes(1)
  })

  it('re-resolves membership and denies immediately after removal', async () => {
    const first = await GET(createNextRequest(baseUrl))
    const fetchesAfterFirst = mockFetchMetaAtlasSeasonRows.mock.calls.length

    installScope({
      membership: { data: null, error: null }
    })
    const second = await GET(createNextRequest(baseUrl))

    expect(first.status).toBe(200)
    expect(second.status).toBe(403)
    expect(mockFetchMetaAtlasSeasonRows).toHaveBeenCalledTimes(
      fetchesAfterFirst
    )
    expect(
      queryLog.find((query) => query.table === 'player_mapping')?.filters
    ).toEqual({
      user_id: 'user-123',
      is_current: true
    })
    expect(first.headers.get('Cache-Control')).toBe('private, no-store')
    expect(second.headers.get('Cache-Control')).toBe('private, no-store')
    expect(first.headers.get('CDN-Cache-Control')).toBeNull()
    expect(second.headers.get('CDN-Cache-Control')).toBeNull()
    expect(first.headers.get('X-Cache')).toBeNull()
    expect(second.headers.get('X-Cache')).toBeNull()
  })

  it('does not reuse one user scope for a different user', async () => {
    const first = await GET(createNextRequest(baseUrl))

    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-456' } },
      error: null
    })
    installScope({
      membership: {
        data: { guild_code: 'OTHER' },
        error: null
      },
      requestedGuilds: {
        OTHER: {
          data: { guild_code: 'OTHER', cluster_code: 'SECOND' },
          error: null
        }
      }
    })

    const second = await GET(createNextRequest(baseUrl))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(
      queryLog.find((query) => query.table === 'player_mapping')?.filters
    ).toEqual({
      user_id: 'user-456',
      is_current: true
    })
    expect(
      queryLog.some(
        (query) =>
          query.table === 'guild_config' && query.filters.guild_code === 'OTHER'
      )
    ).toBe(true)
    expect(second.headers.get('Cache-Control')).toBe('private, no-store')
    expect(second.headers.get('CDN-Cache-Control')).toBeNull()
  })

  it('emits exactly the 15-cell rarity × set(0-4) × encounter(0-2) grid', async () => {
    mockFetchMetaAtlasSeasonRows.mockResolvedValue(gridRows())

    const response = await GET(createNextRequest(baseUrl))
    const body = (await response.json()) as RecommendationBody
    const teams = body.data

    expect(response.status).toBe(200)
    expect(body.scope).toBe('global')
    expect(teams).toHaveLength(15)
    expect(teams.map((team) => team.composition.compositionKey).sort()).toEqual(
      gridRows()
        .map((row) => row.team_hash)
        .sort()
    )
    expect(new Set(teams.map((team) => team.levelString))).toEqual(
      new Set(['M1', 'M2', 'M3', 'M4', 'M5'])
    )
    expect(teams.every((team) => team.rarity === 'Mythic')).toBe(true)
    expect(teams.every((team) => team.rank === 1)).toBe(true)
  })

  it('drops rows outside the set and encounter grid instead of shipping them', async () => {
    mockFetchMetaAtlasSeasonRows.mockResolvedValue([
      { ...atlasRow, team_hash: 'in-grid', set_num: 0, encounter_index: 0 },
      {
        ...atlasRow,
        team_hash: 'out-set-high',
        set_num: 7,
        encounter_index: 0
      },
      {
        ...atlasRow,
        team_hash: 'out-set-low',
        set_num: -1,
        encounter_index: 0
      },
      {
        ...atlasRow,
        team_hash: 'out-enc-high',
        set_num: 1,
        encounter_index: 5
      },
      {
        ...atlasRow,
        team_hash: 'out-enc-low',
        set_num: 2,
        encounter_index: -1
      },
      {
        ...atlasRow,
        team_hash: 'out-rarity',
        rarity: 'Legendary',
        set_num: 3,
        encounter_index: 0
      }
    ])

    const response = await GET(createNextRequest(baseUrl))
    const body = (await response.json()) as RecommendationBody

    expect(response.status).toBe(200)
    expect(body.data.map((team) => team.composition.compositionKey)).toEqual([
      'in-grid'
    ])
    expect(body.data.map((team) => team.levelString)).toEqual(['M1'])
  })

  it('returns a healthy empty result rather than a degraded one when the aggregate has no rows', async () => {
    mockFetchMetaAtlasSeasonRows.mockResolvedValue([])

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false,
      data: []
    })
    expect(response.headers.get('x-meta-source')).toBe('meta-atlas-rpc')
    expect(response.headers.get('x-meta-scope')).toBe('global')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('returns a healthy empty result when no row matches the requested rarity', async () => {
    mockFetchMetaAtlasSeasonRows.mockResolvedValue([
      { ...atlasRow, rarity: 'Legendary' }
    ])

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false,
      data: []
    })
    expect(response.headers.get('x-meta-source')).toBe('meta-atlas-rpc')
    expect(response.headers.get('x-meta-scope')).toBe('global')
  })

  it('keeps the degraded fallback private and scoped in the body', async () => {
    mockFetchMetaAtlasSeasonRows.mockRejectedValue(new Error('aggregate down'))

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(200)
    // Degraded responses still declare scope; only the observability header is withheld.
    expect(await response.json()).toEqual({
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false,
      data: []
    })
    expect(response.headers.get('x-meta-source')).toBe('fallback-error')
    expect(response.headers.get('x-meta-scope')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

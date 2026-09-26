import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

/** The delegate reads the global aggregate; the access gate still applies. */

let mockCreateClient: ReturnType<typeof vi.fn>
let mockRecordCalculationMetric: ReturnType<typeof vi.fn>
let mockAnalyzeTeamCompositions: ReturnType<typeof vi.fn>

const createNextRequest = (url: string) => {
  const urlObj = new URL(url)
  return {
    nextUrl: { searchParams: urlObj.searchParams }
  } as unknown as Request
}

const baseUrl =
  'http://localhost/api/meta-analysis?rarity=Legendary&set=1&season=45'

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

const composition = {
  compositionKey: 'hash-1',
  compositionDisplay: 'Hero1 + Hero2',
  heroNames: ['Hero1', 'Hero2'],
  battlesCount: 25,
  avgDamage: 450000
}

describe('GET /api/meta-analysis', () => {
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
    mockRecordCalculationMetric = vi.fn()
    mockAnalyzeTeamCompositions = vi.fn().mockResolvedValue([composition])

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))
    vi.doMock('@/app/lib/calculations/metrics', () => ({
      recordCalculationMetric: mockRecordCalculationMetric
    }))
    vi.doMock('@/app/lib/services/meta-analysis', () => ({
      analyzeTeamCompositions: mockAnalyzeTeamCompositions
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

    const routeModule = await import('@/app/api/meta-analysis/route')
    GET = routeModule.GET
  })

  it('validates required parameters and marks the denial private', async () => {
    const response = await GET(
      createNextRequest('http://localhost/api/meta-analysis?set=1&season=45')
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockAnalyzeTeamCompositions).not.toHaveBeenCalled()
  })

  it('returns 401 before scope or analysis work when authentication is missing', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null
    })

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(mockAnalyzeTeamCompositions).not.toHaveBeenCalled()
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
  ])('denies %s before any analysis', async (_label, overrides) => {
    installScope(overrides as Partial<ScopeFixture>)

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockAnalyzeTeamCompositions).not.toHaveBeenCalled()
  })

  it('denies a cross-cluster guild filter before any analysis', async () => {
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
    expect(mockAnalyzeTeamCompositions).not.toHaveBeenCalled()
  })

  it('delegates one global cell query and labels the response global', async () => {
    const response = await GET(createNextRequest(baseUrl))
    const body = await response.json()

    expect(response.status).toBe(200)
    // A header-only label lets the UI show global rows as one guild's.
    expect(body).toEqual({
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false,
      data: [composition]
    })
    expect(mockAnalyzeTeamCompositions).toHaveBeenCalledTimes(1)
    expect(mockAnalyzeTeamCompositions).toHaveBeenCalledWith(
      'Legendary',
      1,
      '45',
      null,
      null,
      null,
      mockSupabase
    )
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
    expect(response.headers.get('x-meta-source')).toBe('meta-atlas-rpc')
    expect(response.headers.get('x-meta-scope')).toBe('global')
    expect(response.headers.get('x-meta-guild-filter-ignored')).toBeNull()
    expect(mockRecordCalculationMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'meta_analysis_compositions',
        strategy: 'meta-atlas-global',
        success: true,
        filterCount: 0
      })
    )
    expect(
      queryLog.find((query) => query.table === 'player_mapping')?.filters
    ).toEqual({
      user_id: 'user-123',
      is_current: true
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('forwards numeric filters positionally and counts them for metrics', async () => {
    const response = await GET(
      createNextRequest(`${baseUrl}&minBattles=5&encounterId=1&limit=25`)
    )

    expect(response.status).toBe(200)
    expect(mockAnalyzeTeamCompositions).toHaveBeenCalledWith(
      'Legendary',
      1,
      '45',
      5,
      1,
      25,
      mockSupabase
    )
    expect(mockRecordCalculationMetric).toHaveBeenCalledWith(
      expect.objectContaining({ filterCount: 2 })
    )
  })

  it('admits an own-guild filter but ignores it for scoping and says so', async () => {
    const response = await GET(createNextRequest(`${baseUrl}&guildFilter=OWN`))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-meta-scope')).toBe('global')
    expect(response.headers.get('x-meta-guild-filter-ignored')).toBe('true')
    expect(await response.json()).toEqual({
      scope: 'global',
      requestedGuildFilter: 'OWN',
      guildFilterIgnored: true,
      data: [composition]
    })
    expect(mockAnalyzeTeamCompositions).toHaveBeenCalledWith(
      'Legendary',
      1,
      '45',
      null,
      null,
      null,
      mockSupabase
    )
  })

  it('admits a server-verified same-cluster guild filter and still stays global', async () => {
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
    expect(await response.json()).toMatchObject({
      scope: 'global',
      requestedGuildFilter: 'ALLY',
      guildFilterIgnored: true
    })
    expect(mockAnalyzeTeamCompositions).toHaveBeenCalledWith(
      'Legendary',
      1,
      '45',
      null,
      null,
      null,
      mockSupabase
    )
  })

  it('admits an independent member with no cluster and issues exactly one query', async () => {
    installScope({
      ownGuild: {
        data: { guild_code: 'OWN', cluster_code: null },
        error: null
      }
    })

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(200)
    expect(mockAnalyzeTeamCompositions).toHaveBeenCalledTimes(1)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('re-resolves membership and denies immediately after removal', async () => {
    const first = await GET(createNextRequest(baseUrl))
    const callsAfterFirst = mockAnalyzeTeamCompositions.mock.calls.length

    installScope({
      membership: { data: null, error: null }
    })
    const second = await GET(createNextRequest(baseUrl))

    expect(first.status).toBe(200)
    expect(second.status).toBe(403)
    expect(mockAnalyzeTeamCompositions).toHaveBeenCalledTimes(callsAfterFirst)
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

  it('returns a private empty fallback when the aggregate analysis fails', async () => {
    mockAnalyzeTeamCompositions.mockRejectedValue(new Error('RPC failed'))

    const response = await GET(createNextRequest(baseUrl))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false,
      data: []
    })
    expect(response.headers.get('x-meta-source')).toBe('fallback-error')
    expect(response.headers.get('x-meta-scope')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockRecordCalculationMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'meta-atlas-global',
        success: false,
        errorName: 'Error'
      })
    )
  })
})

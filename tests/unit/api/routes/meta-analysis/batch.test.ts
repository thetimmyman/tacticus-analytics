import { describe, it, expect, vi, beforeEach } from 'vitest'

// The composition aggregate itself is global; this pins the route's own access gate.

let mockCreateClient: ReturnType<typeof vi.fn>
let mockGetCachedClusterContext: ReturnType<typeof vi.fn>
let mockAnalyzeTeamCompositions: ReturnType<typeof vi.fn>

type MockThenError = unknown
type MockThenReturn = unknown
type MockQueryArgs = unknown[]

const createNextRequest = (url: string) => {
  const urlObj = new URL(url)
  return {
    nextUrl: {
      searchParams: urlObj.searchParams
    }
  } as unknown as Request
}

describe('GET /api/meta-analysis/batch', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockGetCachedClusterContext = vi.fn()
    mockAnalyzeTeamCompositions = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@tacticus/app-core/cluster-cache', () => ({
      getCachedClusterContext: mockGetCachedClusterContext
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

    vi.doMock('@tacticus/app-core/rarity-utils', () => ({
      getRarityPrefix: (rarity: string) => (rarity === 'Legendary' ? 'L' : 'M'),
      normalizeRarity: (rarity: string) => rarity
    }))

    vi.doMock('@/app/lib/services/meta-analysis', () => ({
      analyzeTeamCompositions: mockAnalyzeTeamCompositions
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/meta-analysis/batch/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when season is missing', async () => {
      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Missing required parameter: se')
    })
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })

    it('returns 401 when auth errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth error' }
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('cluster context', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 403 when user has no guild or cluster', async () => {
      mockGetCachedClusterContext.mockResolvedValue(null)

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('User has no guild association.')
    })

    it('returns 403 when context has empty guild and cluster', async () => {
      mockGetCachedClusterContext.mockResolvedValue({
        clusterCode: null,
        guildCode: null,
        role: 'member'
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('User has no guild association.')
    })
  })

  describe('successful queries', () => {
    const mockBossData = [
      { rarity: 'Legendary', set: 0, Name: 'Hive Tyrant', encounterId: 0 },
      { rarity: 'Legendary', set: 1, Name: 'Screamer Killer', encounterId: 0 }
    ]

    const mockCompositions = [
      {
        heroNames: ['Hero1', 'Hero2', 'Hero3', 'Hero4', 'Hero5'],
        battlesCount: 50,
        avgDamage: 400000
      }
    ]

    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetCachedClusterContext.mockResolvedValue({
        clusterCode: 'EOT',
        guildCode: 'TEST',
        role: 'member'
      })
      mockAnalyzeTeamCompositions.mockResolvedValue(mockCompositions)
    })

    it('returns batch analysis for cluster user', async () => {
      const createBossQueryMock = () => {
        const result = { data: mockBossData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createBossQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(200)
      expect(body.analyses).toBeDefined()
      expect(body.season).toBe('45')
      expect(body.clusterCode).toBe('EOT')
      expect(body.bossNames).toBeDefined()
    })

    it('analyzes each boss level globally, with no guild or cluster argument', async () => {
      const createBossQueryMock = () => {
        const result = { data: mockBossData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createBossQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      await GET(
        createNextRequest('http://localhost/api/meta-analysis/batch?season=45')
      )

      expect(mockAnalyzeTeamCompositions).toHaveBeenCalledTimes(2)
      expect(mockAnalyzeTeamCompositions).toHaveBeenNthCalledWith(
        1,
        'Legendary',
        0,
        '45',
        2,
        0,
        null,
        mockSupabase
      )
      expect(mockAnalyzeTeamCompositions).toHaveBeenNthCalledWith(
        2,
        'Legendary',
        1,
        '45',
        2,
        0,
        null,
        mockSupabase
      )
    })

    it('forwards an explicit minBattles to the analysis floor', async () => {
      const createBossQueryMock = () => {
        const result = { data: mockBossData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createBossQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      await GET(
        createNextRequest(
          'http://localhost/api/meta-analysis/batch?season=45&minBattles=12'
        )
      )

      expect(mockAnalyzeTeamCompositions).toHaveBeenNthCalledWith(
        1,
        'Legendary',
        0,
        '45',
        12,
        0,
        null,
        mockSupabase
      )
    })

    it('returns default boss levels when no bosses found', async () => {
      const createEmptyQueryMock = () => {
        const result = { data: [], error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createEmptyQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(200)
      expect(body.analyses.length).toBe(5)
    })

    it('accepts rarity parameter', async () => {
      const inTracker = vi.fn()
      const createQueryMock = () => {
        const result = { data: mockBossData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockImplementation((...args: MockQueryArgs) => {
          inTracker(...args)
          return chainable
        })
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45&rarity=Mythic'
      )

      await GET(request)

      expect(inTracker).toHaveBeenCalledWith('rarity', ['Mythic'])
    })

    it('includes side bosses in analysis', async () => {
      const mockBossDataWithSides = [
        { rarity: 'Legendary', set: 0, Name: 'Hive Tyrant', encounterId: 0 },
        { rarity: 'Legendary', set: 0, Name: 'Side Boss 1', encounterId: 1 },
        { rarity: 'Legendary', set: 0, Name: 'Side Boss 2', encounterId: 2 }
      ]

      const createQueryMock = () => {
        const result = { data: mockBossDataWithSides, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(200)
      expect(body.analyses.length).toBe(3)
      expect(body.bossNames['Legendary-0']).toBe('Hive Tyrant')
      expect(body.bossNames['Legendary-0-side1']).toBe('Side Boss 1')
    })

    it('includes recommended teams in response', async () => {
      const mockRecommendedTeams = [
        { team_hash: 'abc123', team_name: 'Test Team' }
      ]

      const createQueryMock = () => {
        const result = { data: mockBossData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createQueryMock())
      mockSupabase.rpc.mockResolvedValue({
        data: mockRecommendedTeams,
        error: null
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(200)
      expect(body.recommendedTeams).toEqual(mockRecommendedTeams)
    })
  })

  describe('guild-only access', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetCachedClusterContext.mockResolvedValue({
        clusterCode: null,
        guildCode: 'TEST',
        role: 'member'
      })
      mockAnalyzeTeamCompositions.mockResolvedValue([])
    })

    it('filters by guild when user has no cluster', async () => {
      const eqTracker = vi.fn()
      const createQueryMock = () => {
        const result = { data: [], error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockImplementation((...args: MockQueryArgs) => {
          eqTracker(...args)
          return chainable
        })
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      await GET(request)

      expect(eqTracker).toHaveBeenCalledWith('Guild', 'TEST')
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetCachedClusterContext.mockResolvedValue({
        clusterCode: 'EOT',
        guildCode: 'TEST',
        role: 'member'
      })
    })

    it('returns 500 when analysis throws', async () => {
      const createQueryMock = () => {
        const result = {
          data: [{ rarity: 'Legendary', set: 0, Name: 'Boss', encounterId: 0 }],
          error: null
        }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation(() => {
        throw new Error('Database connection failed')
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to analyze team composi')
    })

    it('handles individual boss analysis failure gracefully', async () => {
      const createQueryMock = () => {
        const result = {
          data: [{ rarity: 'Legendary', set: 0, Name: 'Boss', encounterId: 0 }],
          error: null
        }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockReturnValue(createQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })
      mockAnalyzeTeamCompositions.mockRejectedValue(
        new Error('Analysis failed')
      )

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/batch?season=45'
      )

      const response = await GET(request)
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(response.status).toBe(200)
      expect(body.analyses[0].error).toBe('Analysis failed')
      expect(body.analyses[0].compositions).toEqual([])
    })
  })

  /** MIXED response: `analyses` are global, `recommendedTeams` honour filters. */
  describe('scope declaration', () => {
    const createQueryMock = () => {
      const result = { data: [], error: null }
      const chainable: Record<string, unknown> = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.in = vi.fn().mockReturnValue(chainable)
      chainable.not = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.limit = vi.fn().mockReturnValue(chainable)
      chainable.then = (
        onFulfilled?: (value: typeof result) => MockThenReturn,
        onRejected?: (reason: MockThenError) => MockThenReturn
      ) => {
        return Promise.resolve(result).then(onFulfilled, onRejected)
      }
      return chainable
    }

    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockAnalyzeTeamCompositions.mockResolvedValue([])
      mockSupabase.from.mockReturnValue(createQueryMock())
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })
    })

    it('labels compositions global and recommended teams guild-scoped', async () => {
      mockGetCachedClusterContext.mockResolvedValue({
        clusterCode: 'EOT',
        guildCode: 'TEST',
        role: 'member'
      })

      const response = await GET(
        createNextRequest('http://localhost/api/meta-analysis/batch?season=45')
      )
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(body.scope).toEqual({
        compositions: 'global',
        recommendedTeams: 'guild'
      })
      expect(body.effectiveScope).toBe('global')
    })

    it('reports cluster scope for recommended teams when the caller has no guild', async () => {
      mockGetCachedClusterContext.mockResolvedValue({
        clusterCode: 'EOT',
        guildCode: null,
        role: 'member'
      })

      const response = await GET(
        createNextRequest('http://localhost/api/meta-analysis/batch?season=45')
      )
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(body.scope.recommendedTeams).toBe('cluster')
      expect(body.scope.compositions).toBe('global')
    })

    it('echoes a requested guild filter and marks it ignored by the global section', async () => {
      mockGetCachedClusterContext.mockResolvedValue({
        clusterCode: 'EOT',
        guildCode: 'TEST',
        role: 'member'
      })

      const response = await GET(
        createNextRequest(
          'http://localhost/api/meta-analysis/batch?season=45&guildFilter=OTHER'
        )
      )
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(body.requestedGuildFilter).toBe('OTHER')
      expect(body.guildFilterIgnored).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_recommended_teams_for_season',
        expect.objectContaining({ p_guild_filter: 'OTHER' })
      )
    })

    it('reports no ignored filter when none was requested', async () => {
      mockGetCachedClusterContext.mockResolvedValue({
        clusterCode: 'EOT',
        guildCode: 'TEST',
        role: 'member'
      })

      const response = await GET(
        createNextRequest('http://localhost/api/meta-analysis/batch?season=45')
      )
      const body = await response.json()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()

      expect(body.requestedGuildFilter).toBeNull()
      expect(body.guildFilterIgnored).toBe(false)
    })
  })

  /** Session-scoped, so never CDN-cacheable. */
  describe('private-header wrapper', () => {
    it('overrides a handler that returns public/CDN headers with the private set', async () => {
      vi.resetModules()
      const { withMetaAnalysisPrivateHeaders } =
        await import('@/app/api/meta-analysis/_scope')
      const { NextResponse } = await import('next/server')

      const publicHandler = async () =>
        NextResponse.json(
          { ok: true },
          {
            headers: {
              'Cache-Control':
                'public, s-maxage=300, stale-while-revalidate=600',
              'CDN-Cache-Control': 'max-age=300',
              'Surrogate-Control': 'max-age=300'
            }
          }
        )

      const wrapped = withMetaAnalysisPrivateHeaders(publicHandler)
      const response = await wrapped()

      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBeNull()
      expect(response.headers.get('Surrogate-Control')).toBeNull()
    })
  })
})

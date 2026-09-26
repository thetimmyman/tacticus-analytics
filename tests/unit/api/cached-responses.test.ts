import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tacticus/app-core/unified-cache', () => ({
  apiCache: {
    getOrFetch: vi.fn(),
    invalidate: vi.fn()
  }
}))

vi.mock('@tacticus/app-core/app-cache', () => ({
  appCache: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn()
  }
}))

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn()
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

function makeQuery(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {}
  q.select = vi.fn(() => q)
  q.eq = vi.fn(() => q)
  q.limit = vi.fn(() => q)
  q.order = vi.fn(() => q)
  q.then = (resolve: (v: typeof result) => unknown) => resolve(result)
  return q
}

describe('Cached API Responses', () => {
  let apiCache: {
    getOrFetch: ReturnType<typeof vi.fn>
    invalidate: ReturnType<typeof vi.fn>
  }
  let appCache: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
  }
  let createServiceClient: ReturnType<typeof vi.fn>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const unifiedCache = await import('@tacticus/app-core/unified-cache')
    const appCacheMod = await import('@tacticus/app-core/app-cache')
    const authServer = await import('@/app/lib/auth/server')

    apiCache = vi.mocked(unifiedCache.apiCache)
    appCache = vi.mocked(appCacheMod.appCache)
    createServiceClient = vi.mocked(authServer.createServiceClient)

    appCache.get.mockResolvedValue(null)
    appCache.set.mockResolvedValue(undefined)
    appCache.del.mockResolvedValue(undefined)

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }
    createServiceClient.mockReturnValue(mockSupabase)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('getCachedGuildRankings', () => {
    it('calls apiCache.getOrFetch with correct key and options', async () => {
      apiCache.getOrFetch.mockResolvedValue([{ guild: 'TEST', damage: 1000 }])

      const { getCachedGuildRankings } =
        await import('@/app/lib/api/cached-responses')
      await getCachedGuildRankings('Season_42')

      expect(apiCache.getOrFetch).toHaveBeenCalledWith(
        'guild_rankings:Season_42',
        expect.any(Function),
        expect.objectContaining({
          ttl: 2 * 60 * 60 * 1000,
          priority: 'high',
          tags: expect.arrayContaining(['guild_rankings', 'Season_42'])
        })
      )
    })

    it('includes cluster_code in tags when provided', async () => {
      apiCache.getOrFetch.mockResolvedValue([])

      const { getCachedGuildRankings } =
        await import('@/app/lib/api/cached-responses')
      await getCachedGuildRankings('Season_42', 'EOT')

      expect(apiCache.getOrFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({
          tags: expect.arrayContaining(['EOT'])
        })
      )
    })

    it('uses global tag when no cluster_code provided', async () => {
      apiCache.getOrFetch.mockResolvedValue([])

      const { getCachedGuildRankings } =
        await import('@/app/lib/api/cached-responses')
      await getCachedGuildRankings('Season_42')

      expect(apiCache.getOrFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({
          tags: expect.arrayContaining(['global'])
        })
      )
    })

    it('returns empty data when cache miss (view not implemented)', async () => {
      apiCache.getOrFetch.mockImplementation(async (_key, fetcher) => {
        return fetcher()
      })

      const { getCachedGuildRankings } =
        await import('@/app/lib/api/cached-responses')
      const result = await getCachedGuildRankings('Season_42')

      expect(mockSupabase.from).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })

    it('does not throw when guild rankings source is unavailable', async () => {
      apiCache.getOrFetch.mockImplementation(async (_key, fetcher) => {
        return fetcher()
      })

      const { getCachedGuildRankings } =
        await import('@/app/lib/api/cached-responses')

      await expect(getCachedGuildRankings('Season_42')).resolves.toEqual([])
    })
  })

  describe('getCachedSeasonData (appCache default)', () => {
    it('on miss returns unique sorted seasons and writes back with a 6h TTL', async () => {
      appCache.get.mockResolvedValue(null)
      mockSupabase.rpc.mockResolvedValue({
        data: ['42', '41', '40'],
        error: null
      })

      const { getCachedSeasonData } =
        await import('@/app/lib/api/cached-responses')
      const result = await getCachedSeasonData('TEST')

      expect(appCache.get).toHaveBeenCalledWith('season_data:TEST:none')
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_distinct_seasons_for_guild',
        {
          p_guild: 'TEST',
          p_cluster_code: undefined
        }
      )
      expect(result).toEqual(['42', '41', '40'])
      expect(appCache.set).toHaveBeenCalledWith(
        'season_data:TEST:none',
        ['42', '41', '40'],
        6 * 60 * 60
      )
    })

    it('includes cluster in the key when provided', async () => {
      appCache.get.mockResolvedValue(null)
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const { getCachedSeasonData } =
        await import('@/app/lib/api/cached-responses')
      await getCachedSeasonData('TEST', 'EOT')

      expect(appCache.get).toHaveBeenCalledWith('season_data:TEST:EOT')
    })

    it('returns the cached value on a hit without hitting the DB', async () => {
      appCache.get.mockResolvedValue(['99', '98'])

      const { getCachedSeasonData } =
        await import('@/app/lib/api/cached-responses')
      const result = await getCachedSeasonData('TEST')

      expect(result).toEqual(['99', '98'])
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('rolls back to apiCache when WI6060_SEASON_DATA_BACKEND=apiCache', async () => {
      vi.stubEnv('WI6060_SEASON_DATA_BACKEND', 'apiCache')
      apiCache.getOrFetch.mockResolvedValue([])

      const { getCachedSeasonData } =
        await import('@/app/lib/api/cached-responses')
      await getCachedSeasonData('TEST')

      expect(apiCache.getOrFetch).toHaveBeenCalledWith(
        'season_data:TEST:none',
        expect.any(Function),
        expect.objectContaining({ ttl: 6 * 60 * 60 * 1000 })
      )
      expect(appCache.get).not.toHaveBeenCalled()
    })
  })

  describe('getCachedPlayerStats', () => {
    it('includes guildCode in cache key when provided', async () => {
      apiCache.getOrFetch.mockResolvedValue({})

      const { getCachedPlayerStats } =
        await import('@/app/lib/api/cached-responses')
      await getCachedPlayerStats('player-123', 'Season_42', 'TEST')

      expect(apiCache.getOrFetch).toHaveBeenCalledWith(
        'player_stats:player-123:Season_42:TEST',
        expect.any(Function),
        expect.any(Object)
      )
    })

    it('uses "any" when no guildCode provided', async () => {
      apiCache.getOrFetch.mockResolvedValue({})

      const { getCachedPlayerStats } =
        await import('@/app/lib/api/cached-responses')
      await getCachedPlayerStats('player-123', 'Season_42')

      expect(apiCache.getOrFetch).toHaveBeenCalledWith(
        'player_stats:player-123:Season_42:any',
        expect.any(Function),
        expect.any(Object)
      )
    })

    it('has 15 minute TTL for player stats', async () => {
      apiCache.getOrFetch.mockResolvedValue({})

      const { getCachedPlayerStats } =
        await import('@/app/lib/api/cached-responses')
      await getCachedPlayerStats('player-123', 'Season_42')

      expect(apiCache.getOrFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({
          ttl: 15 * 60 * 1000
        })
      )
    })
  })

  // Evicts the shared enhanced_data entry cross-pod via appCache.del as well as the per-process sweep.
  describe('invalidateGuildCache', () => {
    it('evicts enhanced_data:<guild> from the shared appCache (cross-pod)', async () => {
      apiCache.invalidate.mockReturnValue(0)

      const { invalidateGuildCache } =
        await import('@/app/lib/api/cached-responses')
      await invalidateGuildCache('TEST')

      expect(appCache.del).toHaveBeenCalledWith('enhanced_data:TEST')
    })

    it('still sweeps the legacy apiCache tags', async () => {
      apiCache.invalidate.mockReturnValue(1)

      const { invalidateGuildCache } =
        await import('@/app/lib/api/cached-responses')
      await invalidateGuildCache('TEST', 'Season_42')

      expect(apiCache.invalidate).toHaveBeenCalledWith(undefined, 'TEST')
      expect(apiCache.invalidate).toHaveBeenCalledWith(undefined, 'Season_42')
    })

    it('returns the summed evicted count across both apiCache tags', async () => {
      apiCache.invalidate.mockImplementation((_pattern, tag) =>
        tag === 'TEST' ? 2 : 3
      )

      const { invalidateGuildCache } =
        await import('@/app/lib/api/cached-responses')

      await expect(invalidateGuildCache('TEST', 'Season_42')).resolves.toBe(5)
    })

    it('does not call appCache.del when rolled back to apiCache', async () => {
      vi.stubEnv('WI6060_ENHANCED_DATA_BACKEND', 'apiCache')
      apiCache.invalidate.mockReturnValue(0)

      const { invalidateGuildCache } =
        await import('@/app/lib/api/cached-responses')
      await invalidateGuildCache('TEST')

      expect(appCache.del).not.toHaveBeenCalled()
    })

    it('handles invalidation errors gracefully', async () => {
      apiCache.invalidate.mockImplementation(() => {
        throw new Error('Cache error')
      })

      const { invalidateGuildCache } =
        await import('@/app/lib/api/cached-responses')

      await expect(invalidateGuildCache('TEST')).resolves.toBe(0)
    })
  })

  describe('warmApiCache', () => {
    it('warms rankings via apiCache and season data via appCache', async () => {
      apiCache.getOrFetch.mockResolvedValue([])
      appCache.get.mockResolvedValue([]) // hit → skip fetchers

      const { warmApiCache } = await import('@/app/lib/api/cached-responses')
      await warmApiCache('TEST', 'Season_42')

      expect(apiCache.getOrFetch).toHaveBeenCalledTimes(1)
      expect(appCache.get).toHaveBeenCalledWith('season_data:TEST:none')
      // No leaderboard warm target: its view was dropped.
      expect(
        appCache.get.mock.calls.some((call) =>
          String(call[0]).startsWith('leaderboard:')
        )
      ).toBe(false)
    })

    it('passes clusterCode through both cache backends', async () => {
      apiCache.getOrFetch.mockResolvedValue([])
      appCache.get.mockResolvedValue([])

      const { warmApiCache } = await import('@/app/lib/api/cached-responses')
      await warmApiCache('TEST', 'Season_42', 'EOT')

      const rankingsCalls = apiCache.getOrFetch.mock.calls
      expect(rankingsCalls.some((call) => call[2]?.tags?.includes('EOT'))).toBe(
        true
      )
      expect(appCache.get).toHaveBeenCalledWith('season_data:TEST:EOT')
    })

    it('handles warming errors gracefully', async () => {
      apiCache.getOrFetch.mockRejectedValue(new Error('Cache warming failed'))
      appCache.get.mockResolvedValue([])

      const { warmApiCache } = await import('@/app/lib/api/cached-responses')

      await expect(warmApiCache('TEST', 'Season_42')).resolves.not.toThrow()
    })
  })
})

import { apiCache } from '@tacticus/app-core/unified-cache'
import { appCache } from '@tacticus/app-core/app-cache'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.api.cached-responses')

// Milliseconds, for the per-process apiCache.
const API_RESPONSE_CACHE_TTL = {
  GUILD_RANKINGS: 2 * 60 * 60 * 1000, // 2 hours
  SEASON_DATA: 6 * 60 * 60 * 1000, // 6 hours
  PLAYER_STATS: 15 * 60 * 1000 // 15 minutes
}

// Seconds, for the Redis-backed appCache (same windows as above).
const CACHE_TTL_SECONDS = {
  SEASON_DATA: 6 * 60 * 60 // 6 hours
}

/**
 * Rollback gates: each site uses the shared `appCache` unless its env var is
 * `'apiCache'`. Exported so the enhanced-data route and its evictor agree.
 */
export const CACHE_BACKEND_GATES = {
  seasonData: process.env.WI6060_SEASON_DATA_BACKEND ?? 'appCache',
  enhancedData: process.env.WI6060_ENHANCED_DATA_BACKEND ?? 'appCache'
} as const

/** Shared-cache key for per-guild enhanced data; writer and evictor must agree. */
export const enhancedDataKey = (guildCode: string): string =>
  `enhanced_data:${guildCode}`

/** Get-or-fetch over the shared appCache, which degrades to null on a Redis outage. */
async function distGetOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  const cached = await appCache.get<T>(key)
  if (cached !== null && cached !== undefined) return cached
  const value = await fetcher()
  if (value !== null && value !== undefined) {
    await appCache.set(key, value, ttlSeconds)
  }
  return value
}

export async function getCachedGuildRankings(
  season: string,
  clusterCode?: string
): Promise<unknown[]> {
  const cacheKey = `guild_rankings:${season}`

  return apiCache.getOrFetch(
    cacheKey,
    async () => {
      // guild_rankings_public view does not exist yet
      return [] as unknown[]
    },
    {
      ttl: API_RESPONSE_CACHE_TTL.GUILD_RANKINGS,
      priority: 'high',
      tags: ['guild_rankings', season, clusterCode || 'global']
    }
  ) as Promise<unknown[]>
}

export async function getCachedSeasonData(
  guildCode: string,
  clusterCode?: string
): Promise<string[]> {
  const cacheKey = `season_data:${guildCode}:${clusterCode || 'none'}`

  const fetcher = async (): Promise<string[]> => {
    const supabase = serviceDb()

    // Season is TEXT: sorting it server-side puts '99' before '100' and the
    // row cap can drop S100+, so the RPC returns distinct seasons instead.
    const { data, error } = await supabase.rpc(
      'get_distinct_seasons_for_guild',
      {
        p_guild: guildCode,
        p_cluster_code: clusterCode ?? undefined
      }
    )

    if (error) {
      logger.error({ err: error }, 'Error fetching season data:')
      throw error
    }

    return (Array.isArray(data) ? data : []) as string[]
  }

  if (CACHE_BACKEND_GATES.seasonData === 'apiCache') {
    return apiCache.getOrFetch(cacheKey, fetcher, {
      ttl: API_RESPONSE_CACHE_TTL.SEASON_DATA,
      priority: 'high',
      tags: ['season_data', guildCode, clusterCode || 'none']
    }) as Promise<string[]>
  }

  return distGetOrFetch<string[]>(
    cacheKey,
    fetcher,
    CACHE_TTL_SECONDS.SEASON_DATA
  )
}

export async function getCachedPlayerStats(
  playerId: string,
  season: string,
  guildCode?: string
): Promise<unknown> {
  return apiCache.getOrFetch(
    `player_stats:${playerId}:${season}:${guildCode || 'any'}`,
    async () => {
      // player_stats_comprehensive view does not exist yet
      return null
    },
    {
      ttl: API_RESPONSE_CACHE_TTL.PLAYER_STATS,
      priority: 'medium',
      tags: ['player_stats', playerId, season, guildCode || 'any']
    }
  )
}

/**
 * Invalidates a guild's cached responses; the appCache del reaches every replica.
 * season_data stays TTL-only (its key is cluster-scoped). Returns the local apiCache count.
 */
export async function invalidateGuildCache(
  guildCode: string,
  season?: string
): Promise<number> {
  try {
    if (CACHE_BACKEND_GATES.enhancedData !== 'apiCache') {
      await appCache.del(enhancedDataKey(guildCode))
      logger.info(
        { guildCode, season },
        'Evicted enhanced_data:<guild> from shared appCache (cross-pod, all replicas)'
      )
    }

    const evicted =
      apiCache.invalidate(undefined, guildCode) +
      (season ? apiCache.invalidate(undefined, season) : 0)

    if (evicted === 0) {
      // Expected: migrated entries live in appCache now.
      logger.info(
        { guildCode, season, evicted },
        'apiCache tag-invalidation evicted 0 entries in this process (migrated entries evicted via appCache.del above)'
      )
    } else {
      logger.info(
        { guildCode, season, evicted },
        'Invalidated legacy apiCache entries for guild (this process only)'
      )
    }

    return evicted
  } catch (error) {
    logger.error({ err: error }, 'Error invalidating guild cache:')
    return 0
  }
}

/** The global leaderboard is served by an RPC via React Query, not warmed here. */
export async function warmApiCache(
  guildCode: string,
  currentSeason: string,
  clusterCode?: string
): Promise<void> {
  try {
    await Promise.all([
      getCachedGuildRankings(currentSeason, clusterCode),
      getCachedSeasonData(guildCode, clusterCode)
    ])

    logger.info({ guildCode }, 'Warmed API cache for guild')
  } catch (error) {
    logger.error({ err: error }, 'Error warming API cache:')
  }
}

/** Cluster context cache; callers supply the data fetchers to keep the package decoupled. */

import { legacyConsoleLogger as logger } from './logger'
import { appCache } from './app-cache'

export interface ClusterContext {
  userId: string
  guildCode: string
  clusterCode: string | null
  role: string
  timestamp: number
}

// Shared Redis cache: it scopes meta-analysis data, so invalidation must reach
// every replica or a moved user keeps their old guild for the TTL.
const CACHE_TTL_SECONDS = 5 * 60
const CACHE_KEY_PREFIX = 'cluster-context:'

export async function getCachedClusterContext(
  userId: string,
  fetchContext: (userId: string) => Promise<{
    guild_code: string
    cluster_code: string | null
    role?: string
  } | null>
): Promise<ClusterContext | null> {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}`
  const cached = await appCache.get<ClusterContext>(cacheKey)
  if (cached) {
    logger.debug('[Cache HIT] Cluster context', { userId })
    return cached
  }

  logger.debug('[Cache MISS] Fetching cluster context', { userId })

  try {
    const clusterInfo = await fetchContext(userId)
    if (!clusterInfo) {
      logger.error('Failed to fetch cluster context', { userId })
      return null
    }

    const context: ClusterContext = {
      userId,
      guildCode: clusterInfo.guild_code,
      clusterCode: clusterInfo.cluster_code || null,
      role: clusterInfo.role || 'member',
      timestamp: Date.now()
    }

    await appCache.set(cacheKey, context, CACHE_TTL_SECONDS)
    return context
  } catch (error) {
    logger.error('Error fetching cluster context:', error)
    return null
  }
}

/** Best-effort, all replicas: the move is already committed and the TTL is the backstop. */
export async function invalidateClusterCache(userId: string): Promise<void> {
  try {
    await appCache.del(`${CACHE_KEY_PREFIX}${userId}`)
    logger.debug('[Cache] Invalidated cluster context', { userId })
  } catch (error) {
    logger.warn('[Cache] Failed to invalidate cluster context', {
      userId,
      error
    })
  }
}

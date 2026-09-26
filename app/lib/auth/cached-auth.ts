/** Cached cluster/guild scope; the fetcher selects only scope columns so no encrypted key is cached. */

import { serviceDb } from '@/app/lib/db'
import { getCachedClusterContext as getSharedClusterContext } from '@tacticus/app-core/cluster-cache'

import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.auth.cached-auth')

/** Never throws; an unresolvable scope is `{ clusterCode: null, guildCode: '' }`. */
export async function getServerClusterContext(userId: string): Promise<{
  clusterCode: string | null
  guildCode: string
}> {
  try {
    const context = await getSharedClusterContext(userId, async (uid) => {
      const { data, error } = await serviceDb()
        .from('player_with_cluster')
        .select('guild_code, cluster_code, role')
        .eq('user_id', uid)
        .eq('is_current', true)
        .maybeSingle()

      if (error) {
        logger.error({ err: error }, 'Error fetching cluster scope:')
        return null
      }

      return (data ?? null) as {
        guild_code: string
        cluster_code: string | null
        role?: string
      } | null
    })

    return {
      clusterCode: context?.clusterCode ?? null,
      guildCode: context?.guildCode ?? ''
    }
  } catch (error) {
    logger.error({ err: error }, 'Error in getServerClusterContext:')
    return { clusterCode: null, guildCode: '' }
  }
}

// No authorization boundary depends on this cache: requireRole re-reads
// player_mapping as the caller. Never cache `api_key_encrypted` in Redis.

import type { SupabaseClient } from '@supabase/supabase-js'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.player-stats.resolve-guild-scope')

/** Every enabled guild in the player's cluster, else [guildCode]. */
export async function resolveGuildScope(
  supabase: SupabaseClient,
  guildCode: string,
  playerClusterCode: string | null
): Promise<string[]> {
  if (!playerClusterCode) {
    return [guildCode]
  }

  try {
    const clusterGuilds = await GuildConfigService.getClusterGuilds(
      supabase,
      playerClusterCode
    )

    if (clusterGuilds.length > 0) {
      return clusterGuilds.map((g) => g.guild_code)
    }

    logger.debug(
      { playerClusterCode: playerClusterCode },
      'No enabled guilds found for cluster:'
    )
    return [guildCode]
  } catch (error) {
    logger.warn({ error: error }, 'Failed to fetch cluster guilds:')
    return [guildCode]
  }
}

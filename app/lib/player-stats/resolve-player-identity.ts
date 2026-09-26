import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.player-stats.resolve-player-identity')

export interface PlayerIdentityResult {
  playerId: string | null
  displayNames: string[]
}

export async function resolvePlayerIdentity(
  supabase: SupabaseClient,
  playerName: string,
  guildCode: string
): Promise<PlayerIdentityResult> {
  try {
    const { data: playerMapping } = await supabase
      .from('player_mapping')
      .select('player_id')
      .eq('display_name', playerName)
      .eq('is_current', true)
      .or(`guild_code.eq.${guildCode},guild_code.is.null`)
      .maybeSingle()

    if (!playerMapping?.player_id) {
      return { playerId: null, displayNames: [playerName] }
    }

    const { data: allMappings } = await supabase
      .from('player_mapping')
      .select('display_name')
      .eq('player_id', playerMapping.player_id)

    const displayNames =
      allMappings && allMappings.length > 0
        ? [...new Set(allMappings.map((m) => m.display_name).filter(Boolean))]
        : [playerName]

    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        { historicalNameCount: displayNames.length },
        'Resolved historical player identity aliases'
      )
    }

    return { playerId: playerMapping.player_id, displayNames }
  } catch (mappingError) {
    logger.warn(
      { mappingError: mappingError },
      'Could not resolve player_id for historical performance:'
    )
    return { playerId: null, displayNames: [playerName] }
  }
}

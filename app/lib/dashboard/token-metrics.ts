import type { TypedSupabaseClient } from '@tacticus/app-core/types'

import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.dashboard.token-metrics')
import type { TokenData } from './home-summary-types'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

type SupabaseClient = TypedSupabaseClient

/** Swallows errors so the landing page degrades gracefully. */
export const getTokenDataForUser = async (
  supabase: SupabaseClient,
  userId: string
): Promise<TokenData | undefined> => {
  try {
    const { data: playerData } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select(
        'last_sync_tokens, last_sync_bombs, next_token_seconds, next_bomb_seconds'
      )
      .eq('user_id', userId)
      .eq('is_current', true)
      .maybeSingle()

    if (!playerData) {
      return undefined
    }

    const tokenData: TokenData = {
      guildRaid: {
        current: playerData.last_sync_tokens || 0,
        max: 3,
        nextInSeconds: playerData.next_token_seconds || null
      }
    }

    if (playerData.last_sync_bombs !== null) {
      tokenData.bombs = {
        current: playerData.last_sync_bombs || 0,
        max: 1,
        nextInSeconds: playerData.next_bomb_seconds || null
      }
    }

    return tokenData
  } catch (error) {
    logger.warn({ error: error }, 'Failed to fetch token data for landing page')
    return undefined
  }
}

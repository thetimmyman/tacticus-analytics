/**
 * Counts Tacticus rejections of a player's API key. Cooldown, decay, threshold
 * and the atomic read-modify-write live in record_player_api_key_auth_failure,
 * because worker pods hit the counter concurrently. Only 401/403 count:
 * timeouts and 5xx say nothing about the key.
 */
import type { ServiceSupabaseClient } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('lib.player-key.strike')

/** A burst inside this window counts once (enforced in SQL). */
export const STRIKE_COOLDOWN_SECONDS = 600
/** A strike older than this restarts the count at 1. */
export const STRIKE_DECAY_SECONDS = 86_400
/** Consecutive counted strikes before api_key_is_valid flips to false. */
export const STRIKE_THRESHOLD = 3

export function isKeyRejection(status: number | null): boolean {
  return status === 401 || status === 403
}

export interface StrikeResult {
  strikes: number
  flagged: boolean
  counted: boolean
}

/** Records one rejection (EXECUTE is service-role only); null on RPC failure. */
export async function recordKeyRejection(
  supabase: ServiceSupabaseClient,
  playerId: string
): Promise<StrikeResult | null> {
  const { data, error } = await supabase.rpc(
    'record_player_api_key_auth_failure',
    {
      p_player_id: playerId,
      p_cooldown_seconds: STRIKE_COOLDOWN_SECONDS,
      p_decay_seconds: STRIKE_DECAY_SECONDS,
      p_threshold: STRIKE_THRESHOLD
    }
  )
  if (error) {
    logger.warn({ playerId, error: error.message }, 'Key strike not recorded')
    return null
  }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return null
  if (row.flagged) {
    logger.warn(
      { playerId, strikes: row.strikes },
      'Player Tacticus API key flagged invalid after repeated rejections'
    )
  }
  return row
}

/** A key Tacticus accepted starts over, so old rejections don't add up. */
export async function clearKeyRejections(
  supabase: ServiceSupabaseClient,
  playerMappingId: number
): Promise<void> {
  const { error } = await supabase
    .from('player_mapping')
    .update({ consecutive_api_key_failures: 0, last_api_key_failure_at: null })
    .eq('id', playerMappingId)
    .gt('consecutive_api_key_failures', 0)
  if (error) {
    logger.warn(
      { playerMappingId, error: error.message },
      'Key strikes not cleared'
    )
  }
}

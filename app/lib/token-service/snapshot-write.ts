import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
import type {
  LiveTokenData,
  PlayerTokenSnapshotRow
} from '@/app/lib/token-service/types'

const logger = createComponentLogger('lib.token-service.snapshot-write')

export function writeBackPlayerTokenSnapshot(
  supabase: SupabaseClient,
  member: PlayerTokenSnapshotRow,
  data: LiveTokenData,
  options: { onlyIfLastSyncBefore?: string } = {}
): boolean {
  const changed =
    data.tokensAvailable !== member.last_sync_tokens ||
    data.bombsAvailable !== member.last_sync_bombs ||
    data.tokenNextSeconds !== member.next_token_seconds ||
    data.bombNextSeconds !== member.next_bomb_seconds ||
    member.api_key_is_valid !== true

  if (!changed) return false

  const now = new Date().toISOString()
  let update = supabase
    .from('player_mapping')
    .update({
      last_sync_tokens: data.tokensAvailable,
      last_sync_bombs: data.bombsAvailable,
      last_sync_at: now,
      next_token_seconds: data.tokenNextSeconds,
      next_bomb_seconds: data.bombNextSeconds,
      api_key_is_valid: true,
      api_key_last_verified: now
    })
    .eq('player_id', member.player_id)
    .eq('is_current', true)
  if (options.onlyIfLastSyncBefore) {
    update = update.or(
      `last_sync_at.is.null,last_sync_at.lt.${options.onlyIfLastSyncBefore}`
    )
  }
  update.then(({ error }) => {
    if (error) {
      logger.warn(
        { player: member.display_name, error: error.message },
        'Failed to update player_mapping after live fetch'
      )
    }
  })
  return true
}

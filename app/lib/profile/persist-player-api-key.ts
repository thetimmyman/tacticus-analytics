// The one place a player's API key is encrypted and persisted; callers scope the service client
// to the authenticated user. Never throws or logs: a throw would turn a committed bind into a 500.

import { encryptApiKey } from '@tacticus/app-core/encryption'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export type PersistPlayerApiKeyResult =
  | { ok: true }
  | { ok: false; reason: 'encrypt_failed' | 'update_failed'; detail?: string }

export async function persistPlayerApiKey(
  supabase: TypedSupabaseClient,
  userId: string,
  apiKey: string,
  options?: { playerPower?: number | null }
): Promise<PersistPlayerApiKeyResult> {
  let encryptedKey: string
  try {
    encryptedKey = await encryptApiKey(apiKey.trim())
  } catch {
    // Nothing derived from the key may leave this function.
    return { ok: false, reason: 'encrypt_failed' }
  }

  try {
    // Stamp api_key_added_at only when absent; a failed read stamps, since the
    // transfer path just wiped the row.
    let stampAddedAt = true
    const { data: currentRow, error: readError } = await supabase
      .from('player_mapping')
      .select('api_key_added_at')
      .eq('user_id', userId)
      .eq('is_current', true)
      .maybeSingle()
    if (!readError && currentRow?.api_key_added_at) {
      stampAddedAt = false
    }

    const timestamp = new Date().toISOString()
    const playerPower = options?.playerPower ?? null
    const { error } = await supabase
      .from('player_mapping')
      .update({
        tacticus_api_key_encrypted: encryptedKey,
        api_key_is_valid: true,
        api_key_last_verified: timestamp,
        ...(stampAddedAt ? { api_key_added_at: timestamp } : {}),
        ...(playerPower !== null ? { player_power: playerPower } : {}),
        updated_at: timestamp
      })
      .eq('user_id', userId)
      .eq('is_current', true)

    if (error) {
      return { ok: false, reason: 'update_failed', detail: error.message }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: 'update_failed',
      detail: error instanceof Error ? error.message : 'unexpected throw'
    }
  }
}

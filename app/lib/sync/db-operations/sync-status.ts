import type { Database as SupabaseDatabase } from '@tacticus/app-core/database.generated'
import {
  logger,
  type StrictSupabaseClient
} from '@/app/lib/sync/db-operations/shared'

type GuildConfigRow =
  SupabaseDatabase['public']['Tables']['guild_config']['Row']

/** `last_sync` is an attempt clock (moves on error, for the retry throttle); success lives in
 * `guild_config.last_successful_sync`. `full_sync_at` gates the 24h repair sweep, so success only. */
export async function updateSyncStatus(
  supabase: StrictSupabaseClient,
  guildCode: string,
  status: 'completed' | 'error',
  data: {
    recordsSynced?: number
    memberCount?: number
    errorMessage?: string | null
  }
): Promise<void> {
  const now = new Date().toISOString()
  const succeeded = status === 'completed'
  const updateData = {
    guild_code: guildCode,
    status,
    last_sync: now,
    ...(succeeded ? { full_sync_at: now } : {}),
    full_sync_success: succeeded,
    records_synced: data.recordsSynced ?? 0,
    battle_count: data.recordsSynced ?? 0,
    member_count: data.memberCount ?? 0,
    error_message: data.errorMessage ?? null,
    updated_at: now
  }

  await supabase
    .from('guild_sync_status')
    .upsert(updateData, { onConflict: 'guild_code' })
}

export async function updateGuildConfigAfterSync(
  supabase: StrictSupabaseClient,
  guildCode: string,
  rankings: { guildRaid: number | null; guildWar: number | null },
  rosterRead = false
): Promise<void> {
  const updateData: Partial<GuildConfigRow> = {
    enabled: true,
    onboarding_completed: true,
    onboarding_completed_at: new Date().toISOString(),
    api_key_last_validated: new Date().toISOString(),
    api_key_is_valid: true,
    api_key_migration_status: 'completed',
    auto_sync_enabled: true,
    consecutive_sync_failures: 0,
    updated_at: new Date().toISOString()
  }

  // Only a confirmed roster read may start the worker's roster throttle window;
  // a failed LOKI fetch resolves to an empty roster and must not.
  if (rosterRead) {
    updateData.last_roster_refresh_at = new Date().toISOString()
  }

  if (rankings.guildRaid !== null && rankings.guildRaid > 0) {
    updateData.GR_Ranking = rankings.guildRaid
  }

  if (rankings.guildWar !== null && rankings.guildWar > 0) {
    updateData.GW_Ranking = rankings.guildWar
  }

  const { error } = await supabase
    .from('guild_config')
    .update(updateData)
    .eq('guild_code', guildCode)

  if (error) {
    logger.error(
      { guildCode },
      `Failed to update onboarding status: ${error.message}`
    )
  }
}

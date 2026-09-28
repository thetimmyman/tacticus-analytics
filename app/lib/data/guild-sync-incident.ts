/** Every read uses the caller's session client, so RLS applies; no service-role read. */
import type {
  PlayerMapping,
  TypedSupabaseClient
} from '@tacticus/app-core/types'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { createComponentLogger } from '@/app/lib/logging'
import { classifyGuildSyncState } from '@/app/lib/data/guild-sync-health'
import type { DeadSyncReason } from '@/app/lib/data/guild-sync-health'

const logger = createComponentLogger('lib.data.guild-sync-incident')

export interface OpenGuildSyncIncident {
  /** Stable across daily re-probes because it never includes the re-stamped validation timestamp. */
  incidentId: string
  reason: DeadSyncReason
  guildCode: string
  guildDisplayName: string | null
  /** Never the key or the owner's email; resolved only for an invalid key. */
  keyOwnerDisplayName: string | null
  lastSuccessfulSyncAt: string | null
  viewerIsLeadership: boolean
}

type ViewerProfile = Pick<PlayerMapping, 'guild_code' | 'role'>

export async function getOpenGuildSyncIncidentForUser(
  client: TypedSupabaseClient,
  profile: ViewerProfile | null | undefined,
  now: Date = new Date()
): Promise<OpenGuildSyncIncident | null> {
  const guildCode = profile?.guild_code ?? ''
  if (!guildCode) return null

  const { data: guild, error } = await client
    .from('guild_config')
    .select(
      'guild_code, display_name, user_id, api_key_is_valid, auto_sync_enabled, last_successful_sync, created_at'
    )
    .eq('guild_code', guildCode)
    .eq('enabled', true)
    .maybeSingle()

  if (error) {
    logger.warn(
      { guildCode, error: error.message },
      'Guild sync incident lookup failed; rendering no banner'
    )
    return null
  }

  if (!guild) return null

  const reason = classifyGuildSyncState(guild, now)
  if (reason === null) return null

  return {
    incidentId: `${guild.guild_code}:${reason}:${guild.last_successful_sync ?? 'never'}`,
    reason,
    guildCode: guild.guild_code,
    guildDisplayName: guild.display_name ?? null,
    keyOwnerDisplayName:
      reason === 'invalid_key'
        ? await resolveKeyOwnerDisplayName(
            client,
            guildCode,
            guild.user_id ?? null
          )
        : null,
    lastSuccessfulSyncAt: guild.last_successful_sync ?? null,
    viewerIsLeadership: canManageHeraldRole(profile?.role)
  }
}

async function resolveKeyOwnerDisplayName(
  client: TypedSupabaseClient,
  guildCode: string,
  ownerUserId: string | null
): Promise<string | null> {
  if (!ownerUserId) return null

  const { data, error } = await client
    .from('player_mapping')
    .select('display_name')
    .eq('user_id', ownerUserId)
    .eq('guild_code', guildCode)
    .eq('is_current', true)
    .maybeSingle()

  if (error) {
    logger.warn(
      { guildCode, error: error.message },
      'Key-owner display name lookup failed; banner falls back to the guild'
    )
    return null
  }

  return data?.display_name ?? null
}

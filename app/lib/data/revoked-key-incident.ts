/** Every read uses the caller's session client, so RLS applies; no service-role read. */
import type {
  PlayerMapping,
  TypedSupabaseClient
} from '@tacticus/app-core/types'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('lib.data.revoked-key-incident')

export interface OpenRevokedKeyIncident {
  /** A new revocation gets a new id so a dismissed banner returns. */
  incidentId: string
  guildCode: string
  guildDisplayName: string | null
  /** Never the key or the owner's email. */
  keyOwnerDisplayName: string | null
  openedAt: string | null
  viewerIsLeadership: boolean
  /** Email is not checked: auth_user_emails is service-role only. */
  hasDiscordContactChannel: boolean
}

type ViewerProfile = Pick<PlayerMapping, 'guild_code' | 'role'>

export async function getOpenRevokedKeyIncidentForUser(
  client: TypedSupabaseClient,
  profile: ViewerProfile | null | undefined
): Promise<OpenRevokedKeyIncident | null> {
  const guildCode = profile?.guild_code ?? ''
  if (!guildCode) return null

  const { data: guild, error } = await client
    .from('guild_config')
    .select(
      'guild_code, display_name, user_id, api_key_last_validated, last_successful_sync, discord_webhook_enabled'
    )
    .eq('guild_code', guildCode)
    .eq('enabled', true)
    .eq('api_key_is_valid', false)
    .maybeSingle()

  if (error) {
    logger.warn(
      { guildCode, error: error.message },
      'Revoked-key incident lookup failed; rendering no banner'
    )
    return null
  }

  if (!guild) return null

  const openedAt = guild.api_key_last_validated ?? guild.last_successful_sync

  return {
    incidentId: `${guild.guild_code}:${openedAt ?? 'unknown'}`,
    guildCode: guild.guild_code,
    guildDisplayName: guild.display_name ?? null,
    keyOwnerDisplayName: await resolveKeyOwnerDisplayName(
      client,
      guildCode,
      guild.user_id ?? null
    ),
    openedAt: openedAt ?? null,
    viewerIsLeadership: canManageHeraldRole(profile?.role),
    hasDiscordContactChannel: guild.discord_webhook_enabled === true
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

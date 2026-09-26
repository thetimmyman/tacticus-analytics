import type { SupabaseClient, User } from '@supabase/supabase-js'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { extractDiscordIdentityClaims } from '@/app/lib/discord/identity-claims'
import { resolveVerifiedPlayers } from '@/app/lib/auth/verified-player-authority'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

const logger = createComponentLogger('lib.discord.sync-profile')

export interface SyncDiscordProfileResult {
  status: 'no_identity' | 'unclaimed' | 'synced'
  discordUsername?: string
}

/** Called in-process, never over HTTP, so the OAuth token never reaches fetch logging. */
export async function syncDiscordProfile(
  supabase: SupabaseClient,
  user: User
): Promise<SyncDiscordProfileResult> {
  const claims = extractDiscordIdentityClaims(user)

  if (!claims) {
    return { status: 'no_identity' }
  }

  // Never the URL: it embeds the snowflake and peers can read avatar_url.
  const discordAvatarHash = claims.avatarHash ?? undefined
  const discordGlobalName = claims.discordGlobalName ?? undefined
  const discordUserId = claims.discordUserId ?? undefined
  const finalDiscordUsername = claims.discordUsername ?? undefined

  logger.info(
    {
      userId: user.id,
      discordUsername: finalDiscordUsername,
      hasAvatar: !!discordAvatarHash
    },
    '[Discord Sync] Syncing Discord profile data'
  )

  // Ownership comes only from the attestation resolver; OAuth identity must never bind a roster row.
  const verifiedPlayers = await resolveVerifiedPlayers(serviceDb(), [user.id])
  if (verifiedPlayers.length === 0) {
    logger.info(
      { userId: user.id },
      '[Discord Sync] No verified player profile is available yet; skipping roster sync'
    )
    return { status: 'unclaimed' }
  }
  const mappingIds = verifiedPlayers.map((row) => row.mappingId)

  // The update is guild-unscoped: backfill only when NO current row has a name and the lookup succeeded.
  const { data: currentProfileRows, error: profileLookupError } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('display_name')
    .in('id', mappingIds)
    .eq('user_id', user.id)
    .eq('is_current', true)

  const shouldUpdateDisplayName =
    !profileLookupError &&
    !(currentProfileRows ?? []).some((row) => row.display_name)

  const updateData = {
    discord_username: finalDiscordUsername,
    discord_user_id: discordUserId || null,
    avatar_url: discordAvatarHash || undefined,
    ...(shouldUpdateDisplayName
      ? { display_name: discordGlobalName || finalDiscordUsername || undefined }
      : {})
  }

  const { error: updateError } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .update(updateData)
    .in('id', mappingIds)
    .eq('user_id', user.id)
    .eq('is_current', true)

  if (updateError) {
    logger.error(
      { err: updateError, userId: user.id },
      '[Discord Sync] Failed to update player profile'
    )
    throw new Error('Failed to sync Discord profile')
  }

  const { error: metadataError } = await supabase.auth.updateUser({
    data: {
      discord_synced: true,
      discord_username: finalDiscordUsername
    }
  })

  if (metadataError) {
    logger.warn(
      { metadataError: metadataError, userId: user.id },
      '[Discord Sync] Failed to update user metadata'
    )
  }

  return { status: 'synced', discordUsername: finalDiscordUsername }
}

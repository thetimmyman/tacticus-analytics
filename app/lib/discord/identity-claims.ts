import type { User, UserIdentity } from '@supabase/supabase-js'
import { toDiscordAvatarHash } from '@/app/lib/discord/avatar'

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/

export interface DiscordIdentityClaims {
  discordUserId: string | null
  discordUsername: string | null
  discordGlobalName: string | null
  avatarUrl: string | null
  /** Raw `avatar` claim, else parsed from `avatar_url`; null for default placeholders. */
  avatarHash: string | null
}

export function findDiscordIdentity(user: User): UserIdentity | undefined {
  return user.identities?.find((identity) => identity.provider === 'discord')
}

/** Self-hosted GoTrue normalizes claims; very old identities keep raw Discord keys. */
export function extractDiscordIdentityClaims(
  user: User
): DiscordIdentityClaims | null {
  const identity = findDiscordIdentity(user)
  if (!identity) return null
  const data = (identity.identity_data ?? {}) as Record<string, unknown>

  const rawId = firstString(data.provider_id, data.sub, data.id)
  const discordUserId =
    rawId && DISCORD_SNOWFLAKE_REGEX.test(rawId) ? rawId : null

  const legacyUsername = firstString(data.username)
  const discriminator = firstString(data.discriminator)
  let discordUsername: string | null
  if (legacyUsername) {
    discordUsername =
      discriminator && discriminator !== '0'
        ? `${legacyUsername}#${discriminator}`
        : legacyUsername
  } else {
    // `#0` marks the no-discriminator system and is never displayed.
    const name = firstString(data.name)
    discordUsername = name ? name.replace(/#0$/, '') : null
  }

  const customClaims = (data.custom_claims ?? {}) as Record<string, unknown>
  const discordGlobalName =
    firstString(customClaims.global_name, data.global_name, data.full_name) ??
    null

  const avatarUrl = firstString(data.avatar_url) ?? null

  return {
    discordUserId,
    discordUsername,
    discordGlobalName,
    avatarUrl,
    avatarHash: toDiscordAvatarHash(firstString(data.avatar) ?? avatarUrl)
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

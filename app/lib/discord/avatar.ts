/**
 * Stored as a hash, never a URL: the CDN URL embeds the snowflake, and peers can read
 * avatar_url under RLS, leaking the withheld discord_user_id. Readers accept legacy URLs.
 */

const DISCORD_AVATAR_URL =
  /^https:\/\/cdn\.discordapp\.com\/avatars\/(\d{17,20})\/(a_[0-9a-f]{32}|[0-9a-f]{32})\.(?:png|jpg|jpeg|webp|gif)(?:\?.*)?$/i

const DISCORD_AVATAR_HASH = /^(?:a_)?[0-9a-f]{32}$/i

/** Null for Discord's default placeholders. */
export function toDiscordAvatarHash(
  value: string | null | undefined
): string | null {
  if (!value) return null
  if (DISCORD_AVATAR_HASH.test(value)) return value
  const match = DISCORD_AVATAR_URL.exec(value)
  return match?.[2] ?? null
}

export function buildDiscordAvatarUrl(
  discordUserId: string | null | undefined,
  storedValue: string | null | undefined
): string | null {
  if (!storedValue) return null
  if (!DISCORD_AVATAR_HASH.test(storedValue)) {
    return storedValue
  }
  if (!discordUserId) return null
  const extension = storedValue.toLowerCase().startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${storedValue}.${extension}`
}

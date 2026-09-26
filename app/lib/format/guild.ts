const GUILD_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type GuildDisplaySource =
  | {
      display_name?: string | null
      guild_tag?: string | null
      guild_code?: string | null
    }
  | null
  | undefined

export function isGuildUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && GUILD_UUID_PATTERN.test(value.trim())
}

export function normalizeGuildIdentifier(
  value: string | null | undefined
): string {
  const trimmed = value?.trim()
  if (!trimmed) return ''
  return isGuildUuid(trimmed) ? trimmed.toLowerCase() : trimmed.toUpperCase()
}

export function formatGuildCodeFallback(
  value: string | null | undefined
): string {
  const normalized = normalizeGuildIdentifier(value)
  if (!normalized) return 'Guild'
  // Never surface any part of a UUID guild_code (it is internal).
  return isGuildUuid(normalized) ? 'Guild' : normalized
}

export function formatGuildDisplayLabel(
  guild: GuildDisplaySource,
  fallbackCode?: string | null
): string {
  const displayName = guild?.display_name?.trim()
  if (displayName && !isGuildUuid(displayName)) return displayName

  const guildTag = guild?.guild_tag?.trim()
  if (guildTag) return guildTag

  return formatGuildCodeFallback(guild?.guild_code ?? fallbackCode)
}

/** Display only: never use for identifiers, URLs, query keys or lookups. */
export function formatGuildTag(
  guild:
    { guild_tag?: string | null; guild_code?: string | null } | null | undefined
): string {
  if (!guild) return ''
  return guild.guild_tag?.trim() || formatGuildCodeFallback(guild.guild_code)
}

export interface GuildMetadataSource {
  guild?: {
    name?: unknown
    guildName?: unknown
    guildTag?: unknown
    tag?: unknown
  } | null
  name?: unknown
  guildName?: unknown
  guildTag?: unknown
  tag?: unknown
}

export interface GuildApiMetadata {
  displayName?: string
  guildTag?: string
}

export interface CurrentGuildMetadata {
  display_name?: string | null
  guild_tag?: string | null
}

export interface GuildConfigMetadataUpdate {
  display_name?: string
  guild_tag?: string
  updated_at?: string
}

const cleanMetadataString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const pickMetadataString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const cleaned = cleanMetadataString(value)
    if (cleaned) return cleaned
  }
  return undefined
}

export const extractGuildApiMetadata = (
  source: GuildMetadataSource | null | undefined
): GuildApiMetadata => {
  if (!source) return {}

  const displayName = pickMetadataString(
    source.guild?.name,
    source.guild?.guildName,
    source.name,
    source.guildName
  )
  const guildTag = pickMetadataString(
    source.guild?.guildTag,
    source.guild?.tag,
    source.guildTag,
    source.tag
  )

  return {
    ...(displayName ? { displayName } : {}),
    ...(guildTag ? { guildTag } : {})
  }
}

export const buildGuildConfigMetadataUpdate = (
  source: GuildMetadataSource | null | undefined,
  current: CurrentGuildMetadata,
  updatedAt = new Date().toISOString()
): GuildConfigMetadataUpdate => {
  const metadata = extractGuildApiMetadata(source)
  const update: GuildConfigMetadataUpdate = {}

  if (metadata.displayName && metadata.displayName !== current.display_name) {
    update.display_name = metadata.displayName
  }

  if (metadata.guildTag && metadata.guildTag !== current.guild_tag) {
    update.guild_tag = metadata.guildTag
  }

  if (update.display_name || update.guild_tag) {
    update.updated_at = updatedAt
  }

  return update
}

import type { Database } from '@/app/lib/db'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import type { GuildAuthorityRow } from './membership-authority'

export interface ApiKeyGuildProof {
  isValid: boolean
  guildInfo?: {
    guildId?: string | null
    guildCode?: string | null
  } | null
}

export interface GuildIdentityRow extends GuildAuthorityRow {
  guild_tag?: string | null
}

export function canonicalizeGuildCode(value: string): string {
  return normalizeGuildIdentifier(value)
}

function normalizeGuildIdentity(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? ''
}

export function guildIdentitiesMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = normalizeGuildIdentity(left)
  const normalizedRight = normalizeGuildIdentity(right)
  return (
    normalizedLeft.length > 0 &&
    normalizedRight.length > 0 &&
    normalizedLeft === normalizedRight
  )
}

export function nullableGuildIdentitiesMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (left == null || right == null) return left == null && right == null
  return guildIdentitiesMatch(left, right)
}

export function apiKeyProvesGuild(
  validation: ApiKeyGuildProof | null,
  guildCode: string | null | undefined
): boolean {
  if (!validation?.isValid) return false

  const expected = normalizeGuildIdentity(guildCode)
  if (!expected) return false
  return [validation.guildInfo?.guildId, validation.guildInfo?.guildCode].some(
    (identifier) => {
      const normalized = normalizeGuildIdentity(identifier)
      return normalized.length > 0 && normalized === expected
    }
  )
}

/** Lookup errors are returned so authority-changing routes fail closed rather than assume absence. */
export async function findGuildByIdentity(
  supabase: Database,
  guildCode: string
): Promise<{
  guild: GuildIdentityRow | null
  error: { message: string; code?: string } | null
}> {
  const fields =
    'id, guild_code, guild_tag, guild_id, display_name, cluster_id, cluster_code, is_cluster'
  const canonicalCode = canonicalizeGuildCode(guildCode)
  const lookups = [
    () =>
      supabase
        .from('guild_config')
        .select(fields)
        .eq('guild_code', canonicalCode)
        .maybeSingle(),
    () =>
      supabase
        .from('guild_config')
        .select(fields)
        .eq('guild_tag', guildCode.trim().toUpperCase())
        .maybeSingle(),
    () =>
      supabase
        .from('guild_config')
        .select(fields)
        .eq('guild_id', canonicalCode)
        .maybeSingle()
  ]

  for (const lookup of lookups) {
    const { data, error } = await lookup()
    if (error) return { guild: null, error }
    if (data) return { guild: data as GuildIdentityRow, error: null }
  }

  const { data: legacy, error: legacyError } = await supabase
    .from('guild_code_legacy_map')
    .select('canonical_guild_code')
    .eq('legacy_guild_code', canonicalCode.toUpperCase())
    .maybeSingle()

  if (legacyError) return { guild: null, error: legacyError }
  if (!legacy?.canonical_guild_code) return { guild: null, error: null }

  const { data: canonicalGuild, error: canonicalError } = await supabase
    .from('guild_config')
    .select(fields)
    .eq('guild_code', legacy.canonical_guild_code)
    .maybeSingle()

  if (canonicalError) return { guild: null, error: canonicalError }
  if (!canonicalGuild) {
    return {
      guild: null,
      error: { message: 'Legacy guild mapping points to a missing guild row' }
    }
  }

  return { guild: canonicalGuild as GuildIdentityRow, error: null }
}

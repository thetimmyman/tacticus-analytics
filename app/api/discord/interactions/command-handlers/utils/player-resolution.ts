import type { Supabase } from '../types'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import { normalizeGuild, normalizeName } from './formatting'

// Messages are user-visible Discord output; keep them byte-stable.

export type LinkedGuildScope = {
  allowedGuilds: string[]
  resolvedRequestedGuild: string | null
}

export type LinkedGuildScopeResult =
  { ok: true; scope: LinkedGuildScope } | { ok: false; message: string }

export function resolveAllowedGuilds({
  linkedGuilds,
  requestedGuild
}: {
  linkedGuilds: string[]
  requestedGuild?: string | null
}): LinkedGuildScopeResult {
  const normalizedLinkedGuilds = Array.from(
    new Set(linkedGuilds.map((guild) => normalizeGuild(guild)).filter(Boolean))
  )

  if (normalizedLinkedGuilds.length === 0) {
    return {
      ok: false,
      message: 'No linked guild context was provided for this lookup.'
    }
  }

  const guildByNormalized = new Map(
    linkedGuilds.map((guild) => [
      normalizeGuild(guild),
      normalizeGuildIdentifier(guild)
    ])
  )

  const resolvedRequestedGuild = requestedGuild
    ? normalizeGuild(requestedGuild)
    : null

  if (
    resolvedRequestedGuild &&
    !normalizedLinkedGuilds.includes(resolvedRequestedGuild)
  ) {
    return {
      ok: false,
      message:
        `Guild ${resolvedRequestedGuild} is not linked to this server. ` +
        `Linked guilds: ${normalizedLinkedGuilds.join(', ')}`
    }
  }

  const allowedGuilds =
    resolvedRequestedGuild !== null
      ? [
          guildByNormalized.get(resolvedRequestedGuild) ??
            normalizeGuildIdentifier(requestedGuild ?? resolvedRequestedGuild)
        ]
      : normalizedLinkedGuilds.map(
          (guild) =>
            guildByNormalized.get(guild) ?? normalizeGuildIdentifier(guild)
        )

  return {
    ok: true,
    scope: { allowedGuilds, resolvedRequestedGuild }
  }
}

type ResolveLookupRow = {
  player_id: string | null
  display_name: string | null
  guild_code: string | null
  timezone?: string | null
  updated_at: string | null
}

/** `guildCode` is raw: /player-time normalizes at its call site, /player-stats needs it raw. */
export type ResolvedPlayerRecord = {
  playerId: string
  displayName: string
  guildCode: string
  timezone: string | null
}

export type ResolvePlayerByNameResult =
  { ok: true; player: ResolvedPlayerRecord } | { ok: false; message: string }

export async function resolvePlayerByName(
  supabase: Supabase,
  {
    playerName,
    allowedGuilds,
    requestedGuild,
    includeTimezone = false
  }: {
    playerName: string
    allowedGuilds: string[]
    requestedGuild: string | null
    includeTimezone?: boolean
  }
): Promise<ResolvePlayerByNameResult> {
  const normalizedQuery = normalizeName(playerName)

  const { data, error } = await supabase
    .from('player_mapping')
    .select(
      includeTimezone
        ? 'player_id, display_name, guild_code, timezone, updated_at'
        : 'player_id, display_name, guild_code, updated_at'
    )
    .in('guild_code', allowedGuilds)
    .eq('is_current', true)
    .ilike('display_name', `%${playerName.trim()}%`)
    .limit(200)

  if (error) {
    return {
      ok: false,
      message: `Failed to resolve player profile: ${error.message}`
    }
  }

  const rows = (data ?? []) as unknown as ResolveLookupRow[]

  const exactMatches = rows.filter((row) =>
    row.display_name
      ? normalizeName(row.display_name) === normalizedQuery
      : false
  )

  const partialMatches =
    exactMatches.length > 0
      ? exactMatches
      : rows.filter((row) =>
          row.display_name
            ? normalizeName(row.display_name).includes(normalizedQuery)
            : false
        )

  const candidates = partialMatches.filter(
    (
      row
    ): row is ResolveLookupRow & {
      player_id: string
      display_name: string
      guild_code: string
    } => Boolean(row.player_id && row.display_name && row.guild_code)
  )

  if (candidates.length === 0) {
    const scopeLabel =
      requestedGuild !== null
        ? `guild ${requestedGuild}`
        : `linked guilds (${allowedGuilds.join(', ')})`
    return {
      ok: false,
      message: `No player matching "${playerName}" was found in ${scopeLabel}.`
    }
  }

  const candidatesByPlayerId = new Map<string, ResolveLookupRow[]>()
  candidates.forEach((row) => {
    const key = row.player_id!
    if (!candidatesByPlayerId.has(key)) {
      candidatesByPlayerId.set(key, [])
    }
    candidatesByPlayerId.get(key)!.push(row)
  })

  if (candidatesByPlayerId.size > 1 && requestedGuild === null) {
    const guildList = Array.from(
      new Set(
        candidates.map((row) => normalizeGuild(row.guild_code ?? 'UNKNOWN'))
      )
    )
    return {
      ok: false,
      message:
        `Multiple players match "${playerName}" across linked guilds (${guildList.join(', ')}). ` +
        'Please specify the `guild` option.'
    }
  }

  const sortedCandidates = [...candidates].sort((a, b) => {
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return bTime - aTime
  })

  const best = sortedCandidates[0]
  if (!best?.player_id || !best.display_name || !best.guild_code) {
    return {
      ok: false,
      message: 'Unable to resolve player identity from roster mappings.'
    }
  }

  return {
    ok: true,
    player: {
      playerId: best.player_id,
      displayName: best.display_name,
      guildCode: best.guild_code,
      timezone: best.timezone ?? null
    }
  }
}

export type PlayerMappingRow = {
  player_id: string | null
  display_name: string | null
  guild_code: string | null
  is_current: boolean | null
}

export type ActiveRoster = {
  playerIds: Set<string>
  normalizedNames: Set<string>
  canonicalNameByPlayerId: Map<string, string>
  canonicalNameByNormalized: Map<string, string>
  playerIdByNormalized: Map<string, string>
}

export type ActiveRosterResult =
  { ok: true; roster: ActiveRoster } | { ok: false; message: string }

export async function loadActiveRoster(
  supabase: Supabase,
  guildsUpper: string[]
): Promise<ActiveRosterResult> {
  const uniqueGuilds = Array.from(
    new Set(guildsUpper.filter(Boolean).map(normalizeGuildIdentifier))
  )
  if (uniqueGuilds.length === 0) {
    return {
      ok: false,
      message:
        'Unable to determine the target guild roster. Please try again later.'
    }
  }

  const { data: records, error } = await supabase
    .from('player_mapping')
    .select('player_id, display_name, guild_code')
    .in('guild_code', uniqueGuilds)
    .eq('is_current', true)

  if (error) {
    return {
      ok: false,
      message: `Failed to load guild roster: ${error.message}`
    }
  }

  const rows = (records ?? []) as PlayerMappingRow[]

  if (rows.length === 0) {
    return {
      ok: false,
      message:
        'No active players are marked as current for the selected guild. Update the roster in the dashboard and try again.'
    }
  }

  const roster: ActiveRoster = {
    playerIds: new Set<string>(),
    normalizedNames: new Set<string>(),
    canonicalNameByPlayerId: new Map<string, string>(),
    canonicalNameByNormalized: new Map<string, string>(),
    playerIdByNormalized: new Map<string, string>()
  }

  rows.forEach((row) => {
    const playerId = row.player_id ?? undefined
    const displayName = row.display_name ?? undefined

    if (playerId) {
      roster.playerIds.add(playerId)
    }

    if (displayName) {
      const canonicalDisplayName = displayName.trim()
      if (canonicalDisplayName.length > 0) {
        const normalizedDisplayName = normalizeName(canonicalDisplayName)
        roster.normalizedNames.add(normalizedDisplayName)
        roster.canonicalNameByNormalized.set(
          normalizedDisplayName,
          canonicalDisplayName
        )
        if (playerId) {
          roster.canonicalNameByPlayerId.set(playerId, canonicalDisplayName)
          roster.playerIdByNormalized.set(normalizedDisplayName, playerId)
        }
      }
    }
  })

  return { ok: true, roster }
}

export function isPlayerInRoster(
  roster: ActiveRoster,
  playerId: string | null | undefined,
  displayName: string | null | undefined
): boolean {
  if (playerId && roster.playerIds.has(playerId)) {
    return true
  }

  if (displayName) {
    const normalizedDisplayName = normalizeName(displayName)
    if (roster.normalizedNames.has(normalizedDisplayName)) {
      return true
    }
  }

  return false
}

export function resolveCanonicalDisplayName(
  roster: ActiveRoster,
  playerId: string | null | undefined,
  displayName: string | null | undefined
): string {
  if (playerId && roster.canonicalNameByPlayerId.has(playerId)) {
    return (
      roster.canonicalNameByPlayerId.get(playerId) ?? displayName ?? playerId
    )
  }

  if (displayName) {
    const normalizedDisplayName = normalizeName(displayName)
    if (roster.canonicalNameByNormalized.has(normalizedDisplayName)) {
      return (
        roster.canonicalNameByNormalized.get(normalizedDisplayName) ??
        displayName
      )
    }
    return displayName
  }

  if (playerId) {
    return playerId
  }

  return 'Unknown'
}

export function createRosterPlayerKey(
  roster: ActiveRoster,
  normalizedGuild: string,
  playerId: string | null | undefined,
  displayName: string
): string {
  if (playerId && roster.playerIds.has(playerId)) {
    return `${normalizedGuild}:${playerId}`
  }
  const normalizedName = normalizeName(displayName)
  const mappedPlayerId = roster.playerIdByNormalized.get(normalizedName)
  if (mappedPlayerId && roster.playerIds.has(mappedPlayerId)) {
    return `${normalizedGuild}:${mappedPlayerId}`
  }
  return `${normalizedGuild}:${normalizedName}`
}

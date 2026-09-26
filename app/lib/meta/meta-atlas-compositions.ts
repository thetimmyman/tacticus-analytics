// Adapter over the GLOBAL (not guild-scoped) `get_meta_atlas_authenticated` aggregate.

import type { TeamComposition } from '@tacticus/app-core/meta-analysis.types'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export interface MetaAtlasAuthenticatedRow {
  team_hash: string
  team_composition: string | null
  meta_team: string | null
  boss_type: string | null
  boss_unit_id: string | null
  sub_boss_name: string | null
  encounter_index: number | null
  encounter_type: string | null
  rarity: string | null
  set_num: number | null
  rarity_set: string | null
  season: string | null
  attack_count: number | string | null
  damage_max: number | string | null
  damage_p90: number | string | null
  damage_p75: number | string | null
  damage_avg: number | string | null
  damage_stddev: number | string | null
  coef_variation: number | string | null
  damage_min: number | string | null
  distinct_players: number | string | null
  distinct_guilds: number | string | null
}

/** Mirrors the server's p_min_attacks clamp. */
export const META_ATLAS_MIN_ATTACKS_FLOOR = 10

const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX_ENTRIES = 8

interface CacheEntry {
  expiresAt: number
  promise: Promise<MetaAtlasAuthenticatedRow[]>
}

const rowsCache = new Map<string, CacheEntry>()

type UntypedRpc = (
  fn: string,
  args: Record<string, unknown>
) => PromiseLike<{
  data: unknown
  error: { message: string; code?: string } | null
}>

function callMetaAtlasRpc(
  supabase: TypedSupabaseClient,
  args: Record<string, unknown>
) {
  const rpc = (
    supabase.rpc as unknown as (...rpcArgs: unknown[]) => unknown
  ).bind(supabase) as unknown as UntypedRpc
  return rpc('get_meta_atlas_authenticated', args)
}

/** Cached per (season, minAttacks): the UI fans out ~30 per-cell requests for the same aggregate. */
export async function fetchMetaAtlasSeasonRows(
  supabase: TypedSupabaseClient,
  season: string,
  minAttacks: number = META_ATLAS_MIN_ATTACKS_FLOOR
): Promise<MetaAtlasAuthenticatedRow[]> {
  const effectiveMinAttacks = Math.max(
    Number.isFinite(minAttacks) ? Math.trunc(minAttacks) : 0,
    META_ATLAS_MIN_ATTACKS_FLOOR
  )
  const cacheKey = `${season}::${effectiveMinAttacks}`
  const now = Date.now()

  const cached = rowsCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.promise
  }

  const promise = (async () => {
    const { data, error } = await callMetaAtlasRpc(supabase, {
      p_min_attacks: effectiveMinAttacks,
      p_exclude_overkills: true,
      p_exclude_retreats: true,
      p_retreat_threshold: 10000,
      p_seasons: [season]
    })
    if (error) {
      throw new Error(`get_meta_atlas_authenticated failed: ${error.message}`)
    }
    return Array.isArray(data) ? (data as MetaAtlasAuthenticatedRow[]) : []
  })()

  // Never cache failures, or one transient error poisons every cell for the TTL.
  promise.catch(() => rowsCache.delete(cacheKey))

  if (rowsCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = rowsCache.keys().next().value
    if (oldestKey !== undefined) rowsCache.delete(oldestKey)
  }
  rowsCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, promise })

  return promise
}

export function clearMetaAtlasRowsCacheForTests(): void {
  rowsCache.clear()
}

/** Parses `get_team_display()`: "Hero A, Hero B + MoW" (" + " only with a MoW). */
export function parseTeamCompositionDisplay(
  display: string | null | undefined
): { heroNames: string[]; mowName: string | null } {
  const trimmed = (display ?? '').trim()
  if (!trimmed) return { heroNames: [], mowName: null }

  const separatorIndex = trimmed.lastIndexOf(' + ')
  const heroesPart =
    separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed
  const mowPart =
    separatorIndex >= 0 ? trimmed.slice(separatorIndex + 3).trim() : ''

  const heroNames = heroesPart
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

  return { heroNames, mowName: mowPart || null }
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0
}

export interface MetaAtlasCompositionOptions {
  minDamageMode: 'min-or-avg' | 'avg'
  standardDeviationMode: 'row-or-zero' | 'zero'
  coefficientFallback: number | null
  bossNameFallback: string
}

export type MetaAtlasComposition = TeamComposition & {
  bossName: string
  encounterId: number
}

/** CV (%) is the only stability signal the RPC exposes; lower is more stable. */
function deriveStability(coefVariation: number | null): {
  stabilityScore: number
  stabilityRank: 'High' | 'Medium' | 'Low'
} {
  if (coefVariation === null) {
    return { stabilityScore: 0, stabilityRank: 'Medium' }
  }
  return {
    stabilityScore: Math.max(0, Math.round(100 - coefVariation)),
    stabilityRank:
      coefVariation <= 30 ? 'High' : coefVariation <= 60 ? 'Medium' : 'Low'
  }
}

export function buildCompositionFromMetaAtlasRow(
  row: MetaAtlasAuthenticatedRow,
  context: { rarity: string; set: number; season: string },
  options: MetaAtlasCompositionOptions
): MetaAtlasComposition {
  const { heroNames, mowName } = parseTeamCompositionDisplay(
    row.team_composition
  )

  const heroDetails = JSON.stringify(
    heroNames.map((name) => ({ unitId: name }))
  )
  const machineOfWarDetails = mowName
    ? JSON.stringify({ unitId: mowName })
    : null

  const coefficientOfVariation =
    numberOrNull(row.coef_variation) ?? options.coefficientFallback
  const { stabilityScore, stabilityRank } = deriveStability(
    numberOrNull(row.coef_variation)
  )

  const avgDamage = numberOrZero(row.damage_avg)
  const minDamage =
    options.minDamageMode === 'min-or-avg'
      ? (numberOrNull(row.damage_min) ?? avgDamage)
      : avgDamage
  const standardDeviation =
    options.standardDeviationMode === 'row-or-zero'
      ? (numberOrNull(row.damage_stddev) ?? 0)
      : 0

  const categories = row.meta_team?.trim() ? [row.meta_team.trim()] : []

  return {
    compositionKey: row.team_hash || heroNames.join('|'),
    compositionDisplay: heroNames.join(' + '),
    heroNames,
    heroDetails,
    machineOfWarDetails,
    battlesCount: numberOrZero(row.attack_count),
    minDamage,
    maxDamage: numberOrZero(row.damage_max),
    avgDamage,
    // No median in the RPC; average is the closest proxy.
    medianDamage: avgDamage,
    standardDeviation,
    coefficientOfVariation:
      coefficientOfVariation as MetaAtlasComposition['coefficientOfVariation'],
    stabilityScore,
    stabilityRank,
    playerCount: numberOrZero(row.distinct_players),
    guildCount: numberOrZero(row.distinct_guilds),
    playerNames: [],
    guildCodes: [],
    rarity: context.rarity,
    set: context.set,
    season: context.season,
    category: categories[0] || 'Other',
    categories,
    bossName:
      row.sub_boss_name?.trim() ||
      row.boss_type?.trim() ||
      options.bossNameFallback,
    encounterId: numberOrZero(row.encounter_index)
  }
}

export function compareMetaAtlasRowsByStrength(
  a: MetaAtlasAuthenticatedRow,
  b: MetaAtlasAuthenticatedRow
): number {
  const p90Delta = numberOrZero(b.damage_p90) - numberOrZero(a.damage_p90)
  if (p90Delta !== 0) return p90Delta
  return numberOrZero(b.attack_count) - numberOrZero(a.attack_count)
}

export function filterMetaAtlasRowsForCell(
  rows: MetaAtlasAuthenticatedRow[],
  cell: { rarity: string; set: number; encounterIndex: number | null }
): MetaAtlasAuthenticatedRow[] {
  return rows.filter((row) => {
    if ((row.rarity ?? '') !== cell.rarity) return false
    if ((row.set_num ?? -1) !== cell.set) return false
    if (cell.encounterIndex === null) return true
    return (row.encounter_index ?? 0) === cell.encounterIndex
  })
}

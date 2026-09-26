import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
import { stripGuildBossPrefix } from '@/app/lib/discord/formatters'
import playbooksCatalog from '@/data/boss-playbooks/playbooks.json'
import {
  type HeraldPingMode,
  type DefeatTransition,
  type AvailabilityTransition
} from './contracts'
import {
  heraldBossIdToPlaybookSlug,
  rarityToRaritySet,
  mainBossIdForGroup
} from './boss-slug'
import { type HeraldBossConfigRow, type HeraldBossConfigLookup } from './config'
import {
  parseSeasonNoteField,
  resolveNoteOverride
} from '@/app/lib/boss-ops/season-note-field'

const logger = createComponentLogger('herald')

export const resolveDefeatPingMode = (
  lookup: HeraldBossConfigLookup,
  transition: DefeatTransition,
  perSeasonPingModes?: Map<string, HeraldPingMode>
): HeraldPingMode | null => {
  const raritySet = rarityToRaritySet(transition.rarity, transition.set)
  if (perSeasonPingModes && transition.season !== null && raritySet) {
    const seasonKey = `${transition.season}|${raritySet}`
    const override = perSeasonPingModes.get(seasonKey)
    if (override) return override
  }
  const direct = lookup.resolve(transition.boss_id, raritySet)
  if (direct?.ping_mode_explicit) return direct.ping_mode
  const mainBossId = mainBossIdForGroup(transition.boss_id)
  if (mainBossId === transition.boss_id) return null
  const group = lookup.resolve(mainBossId, raritySet)
  return group?.ping_mode_explicit ? group.ping_mode : null
}

// Two key shapes share one Set: `${level}_Sub${n}` (planner) and
// `${bossType}|${level}_Sub${n}` (tokens, boss-qualified). Consumers check both.
export const primeSkipSubKey = (level: string, sub: number): string =>
  `${level}_Sub${sub}`
const primeSkipBossKey = (
  bossType: string,
  level: string,
  sub: number
): string => `${bossType}|${primeSkipSubKey(level, sub)}`

export const isPrimeSkipped = (
  set: Set<string> | undefined,
  bossType: string,
  level: string,
  sub: number
): boolean =>
  set !== undefined &&
  (set.has(primeSkipSubKey(level, sub)) ||
    set.has(primeSkipBossKey(bossType, level, sub)))

// Union of planner skip flags and boss_target_tokens.skip; reading only one lets a skipped prime announce.
export const loadSkippedPrimesForSeasons = async (
  supabase: SupabaseClient,
  guildCode: string,
  seasons: string[]
): Promise<Map<string, Set<string>>> => {
  const result = new Map<string, Set<string>>()
  if (seasons.length === 0) return result
  const setForSeason = (season: string): Set<string> => {
    const existing = result.get(season)
    if (existing) return existing
    const created = new Set<string>()
    result.set(season, created)
    return created
  }

  try {
    const { data, error } = await supabase
      .from('upcoming_season_bosses')
      .select('season_number, level, sub_bosses')
      .eq('guild_code', guildCode)
      .in('season_number', seasons)
    if (error) {
      logger.warn(
        {
          guild_code: guildCode,
          error: error.message
        },
        'herald.skipped_primes.load.error'
      )
    } else {
      for (const row of (data ?? []) as Array<{
        season_number: string
        level: string
        sub_bosses: Record<string, unknown> | null
      }>) {
        const sub = row.sub_bosses ?? {}
        const set = setForSeason(row.season_number)
        if (sub.sub1_skip === true) set.add(primeSkipSubKey(row.level, 1))
        if (sub.sub2_skip === true) set.add(primeSkipSubKey(row.level, 2))
      }
    }
  } catch (err) {
    logger.warn(
      {
        guild_code: guildCode,
        error: err instanceof Error ? err.message : String(err)
      },
      'herald.skipped_primes.load.exception'
    )
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- boss_target_tokens is ahead of generated app DB types
    const { data, error } = await (supabase.from('boss_target_tokens') as any)
      .select(
        'boss_name, rarity, set, encounter_id, skip, source, seeded_from_seasons'
      )
      .eq('guild_code', guildCode)
      .eq('skip', true)
      .in('encounter_id', [1, 2])
    if (error) {
      logger.warn(
        {
          guild_code: guildCode,
          error: error.message
        },
        'herald.skipped_primes.tokens.load.error'
      )
    } else {
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        if (row.skip !== true) continue
        // Historical-seed "None Available" rows mean no team data, not officer intent: still announce.
        const seeded = row.seeded_from_seasons
        if (
          row.source === 'historical_seed' &&
          typeof seeded === 'string' &&
          seeded.toLowerCase().includes('none available')
        ) {
          continue
        }
        const bossType =
          typeof row.boss_name === 'string' ? row.boss_name.trim() : ''
        if (!bossType) continue
        const prefix =
          row.rarity === 'Mythic'
            ? 'M'
            : row.rarity === 'Legendary'
              ? 'L'
              : null
        if (!prefix) continue
        const setNum =
          typeof row.set === 'number'
            ? row.set
            : Number.parseInt(String(row.set ?? ''), 10)
        if (!Number.isFinite(setNum) || setNum < 1 || setNum > 5) continue
        const enc =
          typeof row.encounter_id === 'number'
            ? row.encounter_id
            : Number.parseInt(String(row.encounter_id ?? ''), 10)
        if (enc !== 1 && enc !== 2) continue
        const level = `${prefix}${setNum}`
        const key = primeSkipBossKey(bossType, level, enc)
        for (const season of seasons) setForSeason(season).add(key)
      }
    }
  } catch (err) {
    logger.warn(
      {
        guild_code: guildCode,
        error: err instanceof Error ? err.message : String(err)
      },
      'herald.skipped_primes.tokens.load.exception'
    )
  }

  return result
}

// Keyed `${season}|${level}`; wins over the legacy `herald_boss_config.ping_mode`.
export const loadPingModesForSeasons = async (
  supabase: SupabaseClient,
  guildCode: string,
  seasons: string[]
): Promise<Map<string, HeraldPingMode>> => {
  const result = new Map<string, HeraldPingMode>()
  if (seasons.length === 0) return result
  try {
    const { data, error } = await supabase
      .from('upcoming_season_bosses')
      .select('season_number, level, sub_bosses')
      .eq('guild_code', guildCode)
      .in('season_number', seasons)
    if (error) {
      logger.warn(
        {
          guild_code: guildCode,
          error: error.message
        },
        'herald.ping_modes.load.error'
      )
      return result
    }
    for (const row of (data ?? []) as Array<{
      season_number: string
      level: string
      sub_bosses: Record<string, unknown> | null
    }>) {
      const sub = row.sub_bosses ?? {}
      const raw = sub.ping_mode
      if (raw === 'combined' || raw === 'per_side' || raw === 'skip_all') {
        const seasonNum = parseInt(row.season_number, 10)
        if (!Number.isFinite(seasonNum)) continue
        result.set(`${seasonNum}|${row.level}`, raw)
      }
    }
  } catch (err) {
    logger.warn(
      {
        guild_code: guildCode,
        error: err instanceof Error ? err.message : String(err)
      },
      'herald.ping_modes.load.exception'
    )
  }
  return result
}

// Keyed `${season}|${level}|${subIndex}`; missing falls through to HP=0 detection.
export const loadKillThresholdsForSeasons = async (
  supabase: SupabaseClient,
  guildCode: string,
  seasons: string[]
): Promise<Map<string, number>> => {
  const result = new Map<string, number>()
  if (seasons.length === 0) return result
  try {
    const { data, error } = await supabase
      .from('upcoming_season_bosses')
      .select('season_number, level, sub_bosses')
      .eq('guild_code', guildCode)
      .in('season_number', seasons)
    if (error) {
      logger.warn(
        {
          guild_code: guildCode,
          error: error.message
        },
        'herald.kill_thresholds.load.error'
      )
      return result
    }
    for (const row of (data ?? []) as Array<{
      season_number: string
      level: string
      sub_bosses: Record<string, unknown> | null
    }>) {
      const sub = row.sub_bosses ?? {}
      const seasonNum = parseInt(row.season_number, 10)
      if (!Number.isFinite(seasonNum)) continue
      for (const [subIdx, key] of [
        [1, 'sub1_kill_threshold_pct'],
        [2, 'sub2_kill_threshold_pct']
      ] as const) {
        const raw = sub[key]
        const pct =
          typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
              ? Number.parseFloat(raw)
              : NaN
        if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
          result.set(`${seasonNum}|${row.level}|${subIdx}`, pct)
        }
      }
    }
  } catch (err) {
    logger.warn(
      {
        guild_code: guildCode,
        error: err instanceof Error ? err.message : String(err)
      },
      'herald.kill_thresholds.load.exception'
    )
  }
  return result
}

// Includes E0: the in-game epithet lives in boss_mapping, not `prettyBossName`.
export const loadBossDisplayNameOverrides = async (
  supabase: SupabaseClient
): Promise<Map<string, string>> => {
  const map = new Map<string, string>()
  try {
    const { data, error } = await supabase
      .from('boss_mapping')
      .select('boss_type, encounter_index, boss_name')
    if (error) {
      logger.warn(
        {
          error: error.message
        },
        'herald.boss_mapping.load.error'
      )
      return map
    }
    const slugToStrippedIds = new Map<
      string,
      { boss: string | null; prime1: string | null; prime2: string | null }
    >()
    const catalog = playbooksCatalog as {
      bosses?: Array<{
        id?: string
        tacticusTableIds?: { boss?: string; prime1?: string; prime2?: string }
      }>
    }
    for (const b of catalog.bosses ?? []) {
      if (typeof b.id !== 'string') continue
      const ids = b.tacticusTableIds ?? {}
      slugToStrippedIds.set(b.id, {
        boss: stripGuildBossPrefix(ids.boss),
        prime1: stripGuildBossPrefix(ids.prime1),
        prime2: stripGuildBossPrefix(ids.prime2)
      })
    }

    for (const row of (data ?? []) as Array<{
      boss_type: string | null
      encounter_index: number | null
      boss_name: string | null
    }>) {
      if (!row.boss_type || row.encounter_index == null || !row.boss_name)
        continue
      map.set(`${row.boss_type}_E${row.encounter_index}`, row.boss_name)
      const slug = heraldBossIdToPlaybookSlug(`${row.boss_type}_E0`)
      if (!slug) continue
      const ids = slugToStrippedIds.get(slug)
      if (!ids) continue
      const stripped =
        row.encounter_index === 0
          ? ids.boss
          : row.encounter_index === 1
            ? ids.prime1
            : row.encounter_index === 2
              ? ids.prime2
              : null
      if (stripped) {
        map.set(`${stripped}_E${row.encounter_index}`, row.boss_name)
      }
    }
  } catch (err) {
    logger.warn(
      {
        error: err instanceof Error ? err.message : String(err)
      },
      'herald.boss_mapping.load.exception'
    )
  }
  return map
}

export interface SeasonNotes {
  main_notes: string | null | undefined
  side1_notes: string | null | undefined
  side2_notes: string | null | undefined
}

export const loadSeasonNotesForTransitions = async (
  supabase: SupabaseClient,
  guildCode: string,
  transitions: AvailabilityTransition[]
): Promise<Map<string, SeasonNotes>> => {
  const keyParts = new Map<string, { season: string; level: string }>()
  for (const t of transitions) {
    const rs = rarityToRaritySet(t.rarity, t.set)
    if (!rs) continue
    const key = `${t.season}|${rs}`
    if (!keyParts.has(key)) {
      keyParts.set(key, { season: String(t.season), level: rs })
    }
  }
  if (keyParts.size === 0) return new Map()

  const seasons = [...new Set([...keyParts.values()].map((p) => p.season))]
  const levels = [...new Set([...keyParts.values()].map((p) => p.level))]

  try {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
      .from('upcoming_season_bosses' as any)
      .select('season_number, level, sub_bosses')
      .eq('guild_code', guildCode)
      .in('season_number', seasons)
      .in('level', levels)
    if (error || !data) return new Map()

    const result = new Map<string, SeasonNotes>()
    for (const row of data as Array<{
      season_number: string
      level: string
      sub_bosses: Record<string, unknown> | null
    }>) {
      const sb = row.sub_bosses
      const key = `${row.season_number}|${row.level}`
      result.set(key, {
        main_notes: parseSeasonNoteField(sb?.main_notes),
        side1_notes: parseSeasonNoteField(sb?.side1_notes),
        side2_notes: parseSeasonNoteField(sb?.side2_notes)
      })
    }
    return result
  } catch {
    return new Map()
  }
}

export const resolveNoteForEncounter = (
  bossConfig: HeraldBossConfigRow | null,
  seasonNotes: SeasonNotes | null,
  encounterIndex: number
): string | null => {
  // string wins, null = cleared (no fallback), undefined = legacy note.
  const rawSeasonNote =
    encounterIndex === 0
      ? seasonNotes?.main_notes
      : encounterIndex === 1
        ? seasonNotes?.side1_notes
        : encounterIndex === 2
          ? seasonNotes?.side2_notes
          : undefined
  const seasonNote =
    typeof rawSeasonNote === 'string' && rawSeasonNote.trim().length === 0
      ? undefined
      : rawSeasonNote
  const legacyNote =
    encounterIndex === 0
      ? (bossConfig?.notes ?? null)
      : encounterIndex === 1
        ? (bossConfig?.side1_notes ?? null)
        : encounterIndex === 2
          ? (bossConfig?.side2_notes ?? null)
          : null
  const resolved = resolveNoteOverride(seasonNote, legacyNote)
  if (typeof resolved !== 'string') return null
  const trimmed = resolved.trim()
  return trimmed.length > 0 ? trimmed : null
}

export { mergeCombinedPrimeNotes } from '@/app/lib/boss-ops/combined-prime-notes'

/** Empty set on DB error: skipping beats double-posting. */
export const loadAvailabilitySnapshot = async (
  supabase: SupabaseClient,
  guildCode: string
): Promise<Set<string>> => {
  const { data, error } = await supabase
    .from('herald_boss_availability')
    .select('season, boss_id, loop_index, rarity, set_num')
    .eq('guild_code', guildCode)
  if (error || !data) return new Set()
  const out = new Set<string>()
  for (const row of data as Array<{
    season: number | null
    boss_id: string | null
    loop_index: number | null
    rarity: string | null
    set_num: number | null
  }>) {
    if (row.season === null || !row.boss_id) continue
    // Mirrors `herald_boss_availability_unique_v3`; one boss_type can be at L4
    // and M2 in a loop, so a narrower key would block the M2 announcement.
    const loopIdx = row.loop_index ?? 0
    const rarity = row.rarity ?? ''
    const setNum = row.set_num
    out.add(
      `${row.season}|${row.boss_id}|${loopIdx}|${rarity}|${setNum ?? 'null'}`
    )
  }
  return out
}

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEASON_CONFIGS } from '@/app/lib/loki/season-configs'
import { createComponentLogger } from '@/app/lib/logging'
import { buildHeraldBossId } from '@/app/lib/resolvers/boss-identity'

const logger = createComponentLogger('meta-atlas')

export interface MetaAtlasTopTeamsOptions {
  topN?: number
  minAttackCount?: number
  /** Disables the per-boss season cascade. */
  season?: string
  rarities?: string[]
  /** Seasons to look back through per boss (default 10); each season activates only some slots. */
  maxSeasonCascade?: number
}

export interface HeraldSeededTeam {
  meta_team: string
  boss_ids: string[]
  sample_rows: number
}

export interface HeraldSeedResult {
  teams: HeraldSeededTeam[]
  unmappedBosses: string[]
  season: string | null
  seasonsTried: string[]
}

interface MetaAtlasRow {
  boss_type: string
  sub_boss_name: string
  rarity: string
  meta_team: string
  damage_p90: number | null
  attack_count: number | null
  encounter_index: number
  set_num: number
  rn: number
}

/** Keyed by (boss_type, encounter_id): boss_name is shared across encounters and would lose primes. */
const buildKnownBossIdSet = (): Set<string> => {
  const known = new Set<string>()
  for (const config of SEASON_CONFIGS) {
    for (const boss of config.bosses) {
      if (!boss.boss_type) continue
      known.add(`${boss.boss_type}_E${boss.encounter_id}`)
    }
  }
  return known
}

const KNOWN_BOSS_IDS = buildKnownBossIdSet()

const sortSeasonsDesc = (seasons: string[]): string[] => {
  const numeric: Array<{ s: string; n: number }> = []
  const nonNumeric: string[] = []
  for (const s of seasons) {
    const n = Number(s)
    if (Number.isFinite(n)) numeric.push({ s, n })
    else nonNumeric.push(s)
  }
  numeric.sort((a, b) => b.n - a.n)
  nonNumeric.sort((a, b) => b.localeCompare(a))
  return [...numeric.map((x) => x.s), ...nonNumeric]
}

/** `.order()` is required: physical order is oldest-first, so `.limit()` would miss the current season. */
const listCandidateSeasonsDesc = async (
  supabase: SupabaseClient,
  maxSeasons: number
): Promise<string[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- database.generated.ts doesn't include meta_atlas_data
  const { data, error } = await (supabase as any)
    .from('meta_atlas_data')
    .select('season')
    .not('season', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(5_000)

  if (error || !data) {
    logger.error({ error: error?.message }, 'herald.seed.season_list_error')
    return []
  }

  const seen = new Set<string>()
  for (const row of data as Array<{ season: string | null }>) {
    if (row?.season) seen.add(row.season)
  }
  return sortSeasonsDesc(Array.from(seen)).slice(0, maxSeasons)
}

interface MultiSeasonRow extends MetaAtlasRow {
  season: string
}

const fetchRowsAcrossSeasons = async (
  supabase: SupabaseClient,
  seasons: string[],
  minAttackCount: number,
  rarities: string[]
): Promise<MultiSeasonRow[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('meta_atlas_data')
    .select(
      'boss_type, sub_boss_name, rarity, meta_team, damage_p90, attack_count, encounter_index, set_num, season'
    )
    .in('season', seasons)
    .in('rarity', rarities)
    .not('meta_team', 'is', null)
    .gte('attack_count', minAttackCount)

  if (error || !data) {
    logger.error(
      { error: error?.message },
      'herald.seed.meta_atlas_fetch_error'
    )
    return []
  }

  const rows: MultiSeasonRow[] = []
  for (const row of data as Array<Partial<MultiSeasonRow>>) {
    if (!row.boss_type || !row.sub_boss_name || !row.rarity || !row.meta_team)
      continue
    if (typeof row.encounter_index !== 'number') continue
    if (typeof row.set_num !== 'number') continue
    if (typeof row.season !== 'string') continue
    rows.push({
      boss_type: row.boss_type,
      sub_boss_name: row.sub_boss_name,
      rarity: row.rarity,
      meta_team: row.meta_team,
      damage_p90: row.damage_p90 ?? null,
      attack_count: row.attack_count ?? null,
      encounter_index: row.encounter_index,
      set_num: row.set_num,
      season: row.season,
      rn: 0
    })
  }
  return rows
}

const seasonOrderIndex = (seasons: string[]): Map<string, number> => {
  const ordered = sortSeasonsDesc(seasons)
  const idx = new Map<string, number>()
  ordered.forEach((s, i) => idx.set(s, i))
  return idx
}

/** Service-role only. Each slot takes its top-N from the newest season with data for that exact slot. */
export const fetchHeraldSeedFromMetaAtlas = async (
  supabase: SupabaseClient,
  options: MetaAtlasTopTeamsOptions = {}
): Promise<HeraldSeedResult> => {
  const topN = options.topN ?? 2
  const minAttackCount = options.minAttackCount ?? 3
  const rarities = options.rarities ?? ['Legendary', 'Mythic']
  const maxSeasonCascade = Math.max(1, options.maxSeasonCascade ?? 10)

  const seasonsToTry = options.season
    ? [options.season]
    : await listCandidateSeasonsDesc(supabase, maxSeasonCascade)

  if (seasonsToTry.length === 0) {
    logger.warn('herald.seed.no_season')
    return { teams: [], unmappedBosses: [], season: null, seasonsTried: [] }
  }

  const rows = await fetchRowsAcrossSeasons(
    supabase,
    seasonsToTry,
    minAttackCount,
    rarities
  )

  // Each slot is a different fight: never pool a boss's L3 data into L2.
  const groups = new Map<string, MultiSeasonRow[]>()
  for (const row of rows) {
    const key = `${row.boss_type}|${row.encounter_index}|${row.rarity}|${row.set_num}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  const seasonIdx = seasonOrderIndex(seasonsToTry)

  const teamToBossIds = new Map<string, Set<string>>()
  const aggregatedUnmapped = new Set<string>()
  const seasonsWithData = new Set<string>()
  let sampledRowsTotal = 0

  for (const bossRows of groups.values()) {
    bossRows.sort((a, b) => {
      const aIdx = seasonIdx.get(a.season) ?? Number.MAX_SAFE_INTEGER
      const bIdx = seasonIdx.get(b.season) ?? Number.MAX_SAFE_INTEGER
      if (aIdx !== bIdx) return aIdx - bIdx
      const ap = a.damage_p90 ?? -1
      const bp = b.damage_p90 ?? -1
      if (bp !== ap) return bp - ap
      return (b.attack_count ?? 0) - (a.attack_count ?? 0)
    })

    const newestSeason = bossRows[0]?.season
    if (!newestSeason) continue
    const newestRows = bossRows.filter((r) => r.season === newestSeason)

    // Dedupe by meta_team (rows are per team_hash); rows are sorted, so first-seen is best.
    const bestRowPerTeam = new Map<string, MultiSeasonRow>()
    for (const row of newestRows) {
      if (!bestRowPerTeam.has(row.meta_team))
        bestRowPerTeam.set(row.meta_team, row)
    }
    const topRows = Array.from(bestRowPerTeam.values()).slice(0, topN)

    seasonsWithData.add(newestSeason)

    for (const row of topRows) {
      const bossId = buildHeraldBossId(row.boss_type, row.encounter_index)
      if (!KNOWN_BOSS_IDS.has(bossId)) {
        aggregatedUnmapped.add(
          `${row.boss_type}_E${row.encounter_index} (${row.sub_boss_name})`
        )
        continue
      }
      const set = teamToBossIds.get(row.meta_team) ?? new Set<string>()
      set.add(bossId)
      teamToBossIds.set(row.meta_team, set)
      sampledRowsTotal += 1
    }
  }

  const teams: HeraldSeededTeam[] = Array.from(teamToBossIds.entries())
    .map(([meta_team, bossSet]) => ({
      meta_team,
      boss_ids: Array.from(bossSet).sort(),
      sample_rows: bossSet.size
    }))
    .sort(
      (a, b) =>
        b.boss_ids.length - a.boss_ids.length ||
        a.meta_team.localeCompare(b.meta_team)
    )

  if (teams.length === 0) {
    logger.warn(
      {
        seasons_tried: seasonsToTry.length,
        newest_season: seasonsToTry[0] ?? null,
        oldest_tried_season: seasonsToTry[seasonsToTry.length - 1] ?? null
      },
      'herald.seed.cascade_exhausted'
    )
    return {
      teams: [],
      unmappedBosses: Array.from(aggregatedUnmapped),
      season: null,
      seasonsTried: seasonsToTry
    }
  }

  const newestContributingSeason =
    sortSeasonsDesc(Array.from(seasonsWithData))[0] ?? null

  logger.info(
    {
      seasons_with_data: Array.from(seasonsWithData),
      seasons_tried: seasonsToTry.length,
      teams_count: teams.length,
      unmapped_bosses_count: aggregatedUnmapped.size,
      sampled_rows: sampledRowsTotal
    },
    'herald.seed.cascade_fetched'
  )

  return {
    teams,
    unmappedBosses: Array.from(aggregatedUnmapped),
    season: newestContributingSeason,
    seasonsTried: seasonsToTry
  }
}

import 'server-only'

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  LEGACY_SEASON,
  isOfficerSkip,
  selectSeasonScoped
} from '@/app/lib/boss-assignments/target-token-season'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger(
  'lib.boss-assignments.resolve-skipped-primes'
)

/**
 * Union of `boss_target_tokens.skip` (minus the no-data sentinel) and
 * `sub_bosses.subN_skip === true`, strictly, since the writer inserts placeholder rows.
 */

export type SkippedPrimesByStage = Map<string, Set<1 | 2>>

export interface TargetTokenSkipRow {
  boss_name: string | null
  rarity: string | null
  set: number | null
  encounter_id: number | null
  source: string | null
  seeded_from_seasons: string | null
  skip: boolean | null
  season_number: string | null
  target_tokens?: number | null
}

/** Checked `=== true` at runtime; the type does not validate the column. */
export interface SubBossSkipFlags {
  sub1_skip?: boolean
  sub2_skip?: boolean
}

export interface SeasonOpsSkipRow {
  level: string | null
  sub_bosses: SubBossSkipFlags | string | null
}

const STAGE_CODE_PATTERN = /^[LM][1-5]$/

/** Malformed input reads as "not skipped" so a broken row never invents a skip. */
function parseSubBossSkipFlags(rawSubBosses: SeasonOpsSkipRow['sub_bosses']): {
  sub1: boolean
  sub2: boolean
} {
  let subBosses: SubBossSkipFlags | null = null
  if (typeof rawSubBosses === 'string') {
    try {
      const parsed = JSON.parse(rawSubBosses || '{}') as SubBossSkipFlags | null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        subBosses = parsed
      }
    } catch {
      subBosses = null
    }
  } else if (
    rawSubBosses &&
    typeof rawSubBosses === 'object' &&
    !Array.isArray(rawSubBosses)
  ) {
    subBosses = rawSubBosses
  }

  return {
    sub1: subBosses?.sub1_skip === true,
    sub2: subBosses?.sub2_skip === true
  }
}

export function resolveSkippedPrimesFromRows(args: {
  season: string
  targetTokenRows: readonly TargetTokenSkipRow[]
  seasonOpsRows: readonly SeasonOpsSkipRow[]
}): SkippedPrimesByStage {
  const skipped: SkippedPrimesByStage = new Map()
  const add = (stageCode: string, encounterId: 1 | 2) => {
    const existing = skipped.get(stageCode)
    if (existing) {
      existing.add(encounterId)
    } else {
      skipped.set(stageCode, new Set([encounterId]))
    }
  }

  const primeRows = args.targetTokenRows.filter(
    (row) => row.encounter_id === 1 || row.encounter_id === 2
  )
  const scopedRows = selectSeasonScoped(
    primeRows,
    args.season,
    (row) =>
      `${row.boss_name ?? ''}__${row.rarity ?? ''}__${row.set ?? ''}__${row.encounter_id ?? ''}`
  )
  scopedRows.forEach((row) => {
    // boss_target_tokens.set is 1-indexed; the util expects 0-indexed.
    if (
      !row.rarity ||
      typeof row.set !== 'number' ||
      row.set < 1 ||
      row.set > 5
    )
      return
    if (!isOfficerSkip(row)) return
    const stageCode = deriveStageCodeFromSetAndRarity(row.set - 1, row.rarity)
    if (STAGE_CODE_PATTERN.test(stageCode)) {
      add(stageCode, row.encounter_id as 1 | 2)
    }
  })

  for (const row of args.seasonOpsRows) {
    const stageCode = typeof row.level === 'string' ? row.level : ''
    if (!STAGE_CODE_PATTERN.test(stageCode)) continue
    const flags = parseSubBossSkipFlags(row.sub_bosses)
    if (flags.sub1) add(stageCode, 1)
    if (flags.sub2) add(stageCode, 2)
  }

  return skipped
}

/** Fails open: losing prime skips only over-plans. */
export async function loadSkippedPrimesForSeason(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string,
  preloaded?: { targetTokenRows?: readonly TargetTokenSkipRow[] }
): Promise<SkippedPrimesByStage> {
  const [targetTokenRows, seasonOpsRows] = await Promise.all([
    preloaded?.targetTokenRows
      ? Promise.resolve([...preloaded.targetTokenRows])
      : loadTargetTokenRowsForSeason(supabase, guildCode, season),
    loadSeasonOpsSkipRowsForSeason(supabase, guildCode, season)
  ])

  return resolveSkippedPrimesFromRows({
    season,
    targetTokenRows,
    seasonOpsRows
  })
}

export async function loadTargetTokenRowsForSeason(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string
): Promise<TargetTokenSkipRow[]> {
  try {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types do not include boss_target_tokens yet
      .from('boss_target_tokens' as any)
      .select(
        'boss_name, rarity, set, encounter_id, source, seeded_from_seasons, skip, season_number, target_tokens'
      )
      .eq('guild_code', guildCode)
      .in('encounter_id', [0, 1, 2])
      .in('season_number', [season, LEGACY_SEASON])
    if (error) {
      logger.warn(
        { guildCode, season, error: error.message },
        'skipped-primes: target-token read failed; treating store as empty'
      )
      return []
    }
    return (data ?? []) as unknown as TargetTokenSkipRow[]
  } catch (err) {
    logger.warn(
      {
        guildCode,
        season,
        error: err instanceof Error ? err.message : String(err)
      },
      'skipped-primes: target-token read threw; treating store as empty'
    )
    return []
  }
}

export async function loadSeasonOpsSkipRowsForSeason(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string
): Promise<SeasonOpsSkipRow[]> {
  try {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types do not include upcoming_season_bosses yet
      .from('upcoming_season_bosses' as any)
      .select('level, sub_bosses')
      .eq('guild_code', guildCode)
      .eq('season_number', season)
    if (error) {
      logger.warn(
        { guildCode, season, error: error.message },
        'skipped-primes: season-ops skip read failed; treating store as empty'
      )
      return []
    }
    return (data ?? []) as unknown as SeasonOpsSkipRow[]
  } catch (err) {
    logger.warn(
      {
        guildCode,
        season,
        error: err instanceof Error ? err.message : String(err)
      },
      'skipped-primes: season-ops skip read threw; treating store as empty'
    )
    return []
  }
}

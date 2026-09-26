import 'server-only'

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  isOfficerSkip,
  isTargetNoDataSentinel,
  selectSeasonScoped
} from '@/app/lib/boss-assignments/target-token-season'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import {
  loadSeasonOpsSkipRowsForSeason,
  loadTargetTokenRowsForSeason,
  resolveSkippedPrimesFromRows,
  type SkippedPrimesByStage,
  type TargetTokenSkipRow
} from '@/app/lib/boss-assignments/resolve-skipped-primes'

/**
 * Officer targets are the plan of record, never a physics override: consumers do not
 * fabricate kills the model does not support. Fail-open on read errors.
 */

export type OfficerTargetsByStage = Map<string, Map<0 | 1 | 2, number>>

const STAGE_CODE_PATTERN = /^[LM][1-5]$/

export function resolveOfficerTargetsFromRows(args: {
  season: string
  targetTokenRows: readonly TargetTokenSkipRow[]
}): OfficerTargetsByStage {
  const targets: OfficerTargetsByStage = new Map()

  const scopedRows = selectSeasonScoped(
    args.targetTokenRows,
    args.season,
    (row) =>
      `${row.boss_name ?? ''}__${row.rarity ?? ''}__${row.set ?? ''}__${row.encounter_id ?? ''}`
  )

  scopedRows.forEach((row) => {
    if (
      !row.rarity ||
      typeof row.set !== 'number' ||
      row.set < 1 ||
      row.set > 5
    ) {
      return
    }
    if (
      row.encounter_id !== 0 &&
      row.encounter_id !== 1 &&
      row.encounter_id !== 2
    ) {
      return
    }
    if (isOfficerSkip(row)) return
    if (isTargetNoDataSentinel(row.source, row.seeded_from_seasons)) return
    const targetTokens = row.target_tokens
    if (
      typeof targetTokens !== 'number' ||
      !Number.isFinite(targetTokens) ||
      targetTokens <= 0
    ) {
      return
    }
    // boss_target_tokens.set is 1-indexed; the util expects 0-indexed.
    const stageCode = deriveStageCodeFromSetAndRarity(row.set - 1, row.rarity)
    if (!STAGE_CODE_PATTERN.test(stageCode)) return
    const existing = targets.get(stageCode)
    if (existing) {
      existing.set(row.encounter_id, targetTokens)
    } else {
      targets.set(stageCode, new Map([[row.encounter_id, targetTokens]]))
    }
  })

  return targets
}

/** Both reads fail open. */
export async function loadPlanTargetSignalsForSeason(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string
): Promise<{
  skippedPrimes: SkippedPrimesByStage
  officerTargets: OfficerTargetsByStage
}> {
  const [targetTokenRows, seasonOpsRows] = await Promise.all([
    loadTargetTokenRowsForSeason(supabase, guildCode, season),
    loadSeasonOpsSkipRowsForSeason(supabase, guildCode, season)
  ])

  return {
    skippedPrimes: resolveSkippedPrimesFromRows({
      season,
      targetTokenRows,
      seasonOpsRows
    }),
    officerTargets: resolveOfficerTargetsFromRows({ season, targetTokenRows })
  }
}

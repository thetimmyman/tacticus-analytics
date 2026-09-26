import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

export interface CumulativeFeasibilityRow {
  entry: BossStageEntry
  cumulative: number
}

/** Officer target where set, else the model estimate; the one shared fallback. */
export function stageBudgetTokens(entry: BossStageEntry): number {
  return entry.budgetTokensNeeded ?? entry.estimatedTokensNeeded
}

export function stageHasOfficerTarget(entry: BossStageEntry): boolean {
  return [
    entry.encounters.main,
    entry.encounters.prime1,
    entry.encounters.prime2
  ].some((enc) => enc?.budgetSource === 'officer_target')
}

/** `cumulative[i]` covers every stage through `sequence[i]`; officer targets are the plan of record. */
export function buildCumulativeFeasibility(
  sequence: BossStageEntry[]
): CumulativeFeasibilityRow[] {
  return sequence.reduce<CumulativeFeasibilityRow[]>((acc, entry) => {
    const prev = acc.length > 0 ? acc[acc.length - 1]!.cumulative : 0
    acc.push({ entry, cumulative: prev + stageBudgetTokens(entry) })
    return acc
  }, [])
}

/** Null without officer targets. `varianceTokens` sums per-stage variance (unestimable encounters distort totals). */
export interface SequenceBudgetSummary {
  budgetTokens: number
  modelEstimateTokens: number
  varianceTokens: number
  stagesWithTargets: number
}

export function summarizeSequenceBudget(
  sequence: readonly BossStageEntry[]
): SequenceBudgetSummary | null {
  let budgetTokens = 0
  let modelEstimateTokens = 0
  let varianceTokens = 0
  let stagesWithTargets = 0
  for (const entry of sequence) {
    budgetTokens += stageBudgetTokens(entry)
    modelEstimateTokens += entry.estimatedTokensNeeded
    varianceTokens += entry.budgetVarianceTokens ?? 0
    if (stageHasOfficerTarget(entry)) stagesWithTargets += 1
  }
  if (stagesWithTargets === 0) return null
  return {
    budgetTokens,
    modelEstimateTokens,
    varianceTokens,
    stagesWithTargets
  }
}

export function spendableTokensByEnd(tokens: {
  available_now: number
  yet_to_regen: number
}): number {
  return tokens.available_now + tokens.yet_to_regen
}

export function reachableStageIndex(
  rows: CumulativeFeasibilityRow[],
  tokenBudget: number
): number {
  let reachable = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.cumulative <= tokenBudget) {
      reachable = i
    } else {
      break
    }
  }
  return reachable
}

export type FeasibilityTone = 'on_track' | 'watch' | 'at_risk'

/** By feasibility; low confidence only downgrades 'on_track' to 'watch', so thin samples never over-claim. */
export function lapFeasibilityTone(lap: {
  current_lap: number
  projected_finish_lap: number
  projected_finish_pct: number
  confidence: 'low' | 'medium' | 'high'
}): FeasibilityTone {
  const pct = Math.min(1, Math.max(0, lap.projected_finish_pct))
  if (lap.projected_finish_lap < lap.current_lap) return 'at_risk'
  const strong = lap.projected_finish_lap > lap.current_lap || pct >= 0.85
  if (strong) return lap.confidence === 'low' ? 'watch' : 'on_track'
  if (pct >= 0.5) return 'watch'
  return 'at_risk'
}

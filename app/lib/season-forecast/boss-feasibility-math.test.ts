import { describe, it, expect } from 'vitest'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'
import {
  buildCumulativeFeasibility,
  spendableTokensByEnd,
  reachableStageIndex,
  lapFeasibilityTone,
  stageBudgetTokens,
  stageHasOfficerTarget,
  summarizeSequenceBudget
} from './boss-feasibility-math'

function stage(
  stageCode: string,
  loopIndex: number,
  estimatedTokensNeeded: number
): BossStageEntry {
  const enc = (name: string) => ({
    bossName: name,
    bossType: name,
    maxHp: 1_000_000,
    remainingHp: 1_000_000
  })
  return {
    stageCode,
    loopIndex,
    encounters: { main: enc(stageCode), prime1: null, prime2: null },
    estimatedTokensNeeded,
    difficulty: 'medium',
    isCurrentStage: false
  }
}

// `targeted` sources the main encounter from an officer target.
function budgetStage(
  stageCode: string,
  estimatedTokensNeeded: number,
  budgetTokensNeeded: number,
  opts: { targeted?: boolean; variance?: number } = {}
): BossStageEntry {
  const base = stage(stageCode, 0, estimatedTokensNeeded)
  base.budgetTokensNeeded = budgetTokensNeeded
  if (opts.variance !== undefined) base.budgetVarianceTokens = opts.variance
  base.encounters.main.modelEstimateTokens = estimatedTokensNeeded
  base.encounters.main.budgetTokens = budgetTokensNeeded
  base.encounters.main.budgetSource = opts.targeted
    ? 'officer_target'
    : 'model_estimate'
  return base
}

describe('buildCumulativeFeasibility', () => {
  it('produces a running token total across the sequence', () => {
    const rows = buildCumulativeFeasibility([
      stage('A', 0, 5),
      stage('B', 0, 3),
      stage('C', 0, 8)
    ])
    expect(rows.map((r) => r.cumulative)).toEqual([5, 8, 16])
    expect(rows.map((r) => r.entry.stageCode)).toEqual(['A', 'B', 'C'])
  })

  it('runs the cumulative on the BUDGET when budget fields exist (WI-4530)', () => {
    const rows = buildCumulativeFeasibility([
      budgetStage('A', 26, 20, { targeted: true, variance: 6 }),
      budgetStage('B', 3, 3),
      stage('C', 0, 8)
    ])
    expect(rows.map((r) => r.cumulative)).toEqual([20, 23, 31])
  })

  it('returns an empty array for an empty sequence', () => {
    expect(buildCumulativeFeasibility([])).toEqual([])
  })

  it('handles a single stage', () => {
    const rows = buildCumulativeFeasibility([stage('A', 0, 4)])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.cumulative).toBe(4)
  })
})

describe('spendableTokensByEnd', () => {
  it('sums current bank and projected regen', () => {
    expect(spendableTokensByEnd({ available_now: 11, yet_to_regen: 35 })).toBe(
      46
    )
  })

  it('is just the bank when nothing regenerates', () => {
    expect(spendableTokensByEnd({ available_now: 7, yet_to_regen: 0 })).toBe(7)
  })
})

describe('reachableStageIndex', () => {
  const rows = buildCumulativeFeasibility([
    stage('A', 0, 5), // cumulative 5
    stage('B', 0, 3), // cumulative 8
    stage('C', 0, 8) // cumulative 16
  ])

  it('returns -1 when the budget cannot clear even the first stage', () => {
    expect(reachableStageIndex(rows, 4)).toBe(-1)
  })

  it('returns the last stage whose cumulative cost fits the budget', () => {
    expect(reachableStageIndex(rows, 5)).toBe(0)
    expect(reachableStageIndex(rows, 8)).toBe(1)
    expect(reachableStageIndex(rows, 15)).toBe(1)
  })

  it('returns the final index when the budget clears everything', () => {
    expect(reachableStageIndex(rows, 16)).toBe(2)
    expect(reachableStageIndex(rows, 100)).toBe(2)
  })
})

describe('lapFeasibilityTone', () => {
  const lap = (
    over: Partial<Parameters<typeof lapFeasibilityTone>[0]>
  ): Parameters<typeof lapFeasibilityTone>[0] => ({
    current_lap: 3,
    projected_finish_lap: 3,
    projected_finish_pct: 0.9,
    confidence: 'high',
    ...over
  })

  it('is at_risk when projected to fall short of the current lap', () => {
    expect(
      lapFeasibilityTone(
        lap({ projected_finish_lap: 2, projected_finish_pct: 0.99 })
      )
    ).toBe('at_risk')
  })

  it('is on_track when finishing ahead of the current lap', () => {
    expect(
      lapFeasibilityTone(
        lap({ projected_finish_lap: 5, projected_finish_pct: 0.2 })
      )
    ).toBe('on_track')
  })

  it('is on_track when nearly completing the current lap (pct >= 0.85)', () => {
    expect(lapFeasibilityTone(lap({ projected_finish_pct: 0.85 }))).toBe(
      'on_track'
    )
  })

  it('downgrades a strong projection to watch when confidence is low', () => {
    expect(
      lapFeasibilityTone(lap({ projected_finish_pct: 0.95, confidence: 'low' }))
    ).toBe('watch')
  })

  it('is watch for a middling finish (0.5 <= pct < 0.85)', () => {
    expect(lapFeasibilityTone(lap({ projected_finish_pct: 0.6 }))).toBe('watch')
  })

  it('is at_risk for a weak finish (pct < 0.5)', () => {
    expect(lapFeasibilityTone(lap({ projected_finish_pct: 0.3 }))).toBe(
      'at_risk'
    )
  })

  it('does NOT show on_track purely because confidence is high (the fixed bug)', () => {
    expect(
      lapFeasibilityTone(lap({ projected_finish_lap: 2, confidence: 'high' }))
    ).toBe('at_risk')
  })
})

describe('stageBudgetTokens / stageHasOfficerTarget (WI-4530)', () => {
  it('falls back to the model estimate for entries without budget fields', () => {
    const legacy = stage('A', 0, 7)
    expect(stageBudgetTokens(legacy)).toBe(7)
    expect(stageHasOfficerTarget(legacy)).toBe(false)
  })

  it('prefers the budget and detects officer-target encounters', () => {
    const targeted = budgetStage('A', 26, 20, { targeted: true })
    expect(stageBudgetTokens(targeted)).toBe(20)
    expect(stageHasOfficerTarget(targeted)).toBe(true)

    const estimated = budgetStage('B', 3, 3)
    expect(stageBudgetTokens(estimated)).toBe(3)
    expect(stageHasOfficerTarget(estimated)).toBe(false)
  })
})

describe('summarizeSequenceBudget (WI-4530)', () => {
  it('returns null when no stage carries an officer target (target-less no-op)', () => {
    expect(summarizeSequenceBudget([])).toBeNull()
    expect(
      summarizeSequenceBudget([stage('A', 0, 5), stage('B', 0, 3)])
    ).toBeNull()
    // Budget fields present but every source is a model estimate: still null.
    expect(
      summarizeSequenceBudget([budgetStage('A', 5, 5), budgetStage('B', 3, 3)])
    ).toBeNull()
  })

  it('aggregates budget, estimate, and variance across the span', () => {
    const summary = summarizeSequenceBudget([
      budgetStage('A', 26, 20, { targeted: true, variance: 6 }),
      budgetStage('B', 3, 3),
      stage('C', 0, 8)
    ])
    expect(summary).toEqual({
      budgetTokens: 31,
      modelEstimateTokens: 37,
      varianceTokens: 6,
      stagesWithTargets: 1
    })
  })

  it('sums variance only where it was observed (incl. explicit zero)', () => {
    const summary = summarizeSequenceBudget([
      budgetStage('A', 20, 20, { targeted: true, variance: 0 }),
      budgetStage('B', 10, 14, { targeted: true, variance: -4 })
    ])
    expect(summary).toEqual({
      budgetTokens: 34,
      modelEstimateTokens: 30,
      varianceTokens: -4,
      stagesWithTargets: 2
    })
  })
})

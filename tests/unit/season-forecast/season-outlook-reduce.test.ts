import { describe, it, expect } from 'vitest'
import {
  reduceSeasonOutlook,
  deriveConfidence,
  SEASON_MAX_TOKENS_PER_PLAYER
} from '@/app/lib/season-forecast/season-outlook-reduce'
import type { GeneratedSeasonPlanPayload } from '@/app/lib/boss-assignments/season-planner/generate-season-plan'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

const NOW = Date.parse('2026-06-19T00:00:00.000Z')
const SEASON_END = '2026-06-27T00:00:00.000Z'

function makePayload(
  over: {
    metrics?: Partial<GeneratedSeasonPlanPayload['plan']['metrics']>
    finalMain?: { bossName: string; maxHp: number; remainingHp: number } | null
    finalStageCode?: string
    finalLoopIndex?: number
    seasonEnd?: string
    memberCount?: number
    tokensUsed?: number
    tokensRemaining?: number
    tokensWaste?: number
    playersAtCapRisk?: number
    sequenceLen?: number
  } = {}
): GeneratedSeasonPlanPayload {
  const main =
    over.finalMain === undefined
      ? { bossName: 'ScreamerKiller', maxHp: 1_000_000, remainingHp: 400_000 }
      : over.finalMain
  return {
    season: '105',
    season_end_at: over.seasonEnd ?? SEASON_END,
    plan: {
      sessions: [],
      finalRaidState: {
        stageCode: over.finalStageCode ?? 'C4',
        loopIndex: over.finalLoopIndex ?? 5,
        encounters: {
          0: main
            ? {
                encounterId: 0,
                stageCode: over.finalStageCode ?? 'C4',
                loopIndex: over.finalLoopIndex ?? 5,
                bossName: main.bossName,
                maxHp: main.maxHp,
                remainingHp: main.remainingHp
              }
            : (undefined as never)
        }
      },
      metrics: {
        tokensSpent: 530,
        overkillDamage: 0,
        bossesDefeated: 12,
        loopAdvances: 4,
        wastedTokens: 120,
        wastedTicks: 0,
        ...over.metrics
      },
      warnings: []
    },
    remainingBossSequence: Array.from(
      { length: over.sequenceLen ?? 6 },
      () => ({})
    ),
    member_count: over.memberCount ?? 30,
    tokens_used_this_season: over.tokensUsed ?? 190,
    tokens_remaining_spendable: over.tokensRemaining ?? 650,
    tokens_projected_waste: over.tokensWaste ?? 120,
    players_at_cap_risk: over.playersAtCapRisk ?? 4
  } as unknown as GeneratedSeasonPlanPayload
}

describe('reduceSeasonOutlook', () => {
  it('surfaces the real season-token economy (used / remaining / waste / budget)', () => {
    const out = reduceSeasonOutlook(makePayload(), {
      guildCode: 'ABCD',
      seasonNumber: 105,
      nowMs: NOW
    })
    expect(out.seasonBudget).toBe(30 * SEASON_MAX_TOKENS_PER_PLAYER) // 840
    expect(out.tokensUsed).toBe(190)
    expect(out.tokensRemaining).toBe(650)
    expect(out.projectedWaste).toBe(120)
    expect(out.projectedForwardSpend).toBe(530)
    expect(out.memberCount).toBe(30)
    expect(out.playersAtCapRisk).toBe(4)
    expect(out.secondsRemaining).toBe(8 * 24 * 3600)
  })

  it('caps the budget basis at the 30-member guild ceiling (stale is_current rows)', () => {
    const out = reduceSeasonOutlook(makePayload({ memberCount: 33 }), {
      guildCode: 'ABCD',
      seasonNumber: 105,
      nowMs: NOW
    })
    expect(out.memberCount).toBe(33) // real roster size preserved
    expect(out.seasonBudget).toBe(30 * SEASON_MAX_TOKENS_PER_PLAYER) // 840, not 924
  })

  it('derives a multi-lap rotation finish with a pretty boss name + lap fill %', () => {
    const out = reduceSeasonOutlook(makePayload(), {
      guildCode: 'ABCD',
      seasonNumber: 105,
      nowMs: NOW
    })
    expect(out.finish).not.toBeNull()
    expect(out.finish?.loopIndex).toBe(5) // display "Lap 6"
    expect(out.finish?.bossName).toBe('Screamer Killer')
    expect(out.finish?.pctIntoFinalStage).toBeCloseTo(0.6)
    expect(out.finish?.bossesDefeatedForward).toBe(12)
  })

  it('maps lowercase rotation canonical slugs to friendly boss names', () => {
    // Lowercase canonicals ('rogaldorn') must not leak into the headline.
    const out = reduceSeasonOutlook(
      makePayload({
        finalMain: {
          bossName: 'rogaldorn',
          maxHp: 1_000_000,
          remainingHp: 400_000
        }
      }),
      { guildCode: 'ABCD', seasonNumber: 105, nowMs: NOW }
    )
    expect(out.finish?.bossName).toBe('Rogal Dorn')
  })

  it('returns finish=null (no fabricated finish) when there is no rotation data', () => {
    const out = reduceSeasonOutlook(makePayload({ sequenceLen: 0 }), {
      guildCode: 'ABCD',
      seasonNumber: 105,
      nowMs: NOW
    })
    expect(out.finish).toBeNull()
    expect(out.tokensUsed).toBe(190)
  })

  it('clamps negatives and a 0-HP final stage to a clean 0..1 fill', () => {
    const out = reduceSeasonOutlook(
      makePayload({
        finalMain: { bossName: 'Ghazghkull', maxHp: 0, remainingHp: 0 },
        tokensWaste: -5,
        // tokensSpent must stay > 0 or the no-signal guard suppresses the finish.
        metrics: { wastedTokens: -5, tokensSpent: 5, bossesDefeated: -3 }
      }),
      { guildCode: 'ABCD', seasonNumber: 105, nowMs: NOW }
    )
    expect(out.finish?.pctIntoFinalStage).toBe(0)
    expect(out.projectedWaste).toBe(0)
    expect(out.finish?.bossesDefeatedForward).toBe(0)
  })

  it('uses the pace-based waste field, not the planner optimistic wastedTokens', () => {
    const out = reduceSeasonOutlook(
      makePayload({ tokensWaste: 240, metrics: { wastedTokens: 30 } }),
      { guildCode: 'ABCD', seasonNumber: 105, nowMs: NOW }
    )
    expect(out.projectedWaste).toBe(240)
  })

  it('suppresses the finish when the sim modelled no spend (no damage signal)', () => {
    const out = reduceSeasonOutlook(
      makePayload({ metrics: { tokensSpent: 0, bossesDefeated: 0 } }),
      { guildCode: 'ABCD', seasonNumber: 105, nowMs: NOW }
    )
    expect(out.finish).toBeNull()
    expect(out.confidence).toBe('low')
    expect(out.tokensUsed).toBe(190)
  })

  it('reports 0 seconds remaining once the season has ended', () => {
    const out = reduceSeasonOutlook(
      makePayload({ seasonEnd: '2026-06-10T00:00:00.000Z' }),
      { guildCode: 'ABCD', seasonNumber: 105, nowMs: NOW }
    )
    expect(out.secondsRemaining).toBe(0)
  })
})

describe('reduceSeasonOutlook — officer budget block', () => {
  const OPTS = { guildCode: 'ABCD', seasonNumber: 105, nowMs: NOW }

  const seqEntry = (
    stageCode: string,
    loopIndex: number,
    estimatedTokensNeeded: number,
    budget?: {
      budgetTokensNeeded: number
      targeted?: boolean
      variance?: number
    }
  ): BossStageEntry => {
    const entry: BossStageEntry = {
      stageCode,
      loopIndex,
      encounters: {
        main: {
          bossName: `${stageCode}_main`,
          bossType: `${stageCode}_main`,
          maxHp: 1_000_000,
          remainingHp: 1_000_000
        },
        prime1: null,
        prime2: null
      },
      estimatedTokensNeeded,
      difficulty: 'medium',
      isCurrentStage: false
    }
    if (budget) {
      entry.budgetTokensNeeded = budget.budgetTokensNeeded
      if (budget.variance !== undefined) {
        entry.budgetVarianceTokens = budget.variance
      }
      entry.encounters.main.budgetTokens = budget.budgetTokensNeeded
      entry.encounters.main.budgetSource = budget.targeted
        ? 'officer_target'
        : 'model_estimate'
      entry.encounters.main.modelEstimateTokens = estimatedTokensNeeded
    }
    return entry
  }

  const withSequence = (sequence: BossStageEntry[]) => {
    const payload = makePayload()
    payload.remainingBossSequence = sequence
    return payload
  }

  it('is ABSENT for a target-less payload even when the finish is locatable', () => {
    const out = reduceSeasonOutlook(
      withSequence([seqEntry('C3', 5, 26), seqEntry('C4', 5, 10)]),
      OPTS
    )
    expect('budget' in out).toBe(false)
    expect(JSON.stringify(out)).not.toContain('"budget"')
  })

  it('is ABSENT when budget fields exist but no officer target is in the span', () => {
    const out = reduceSeasonOutlook(
      withSequence([
        seqEntry('C3', 5, 26, { budgetTokensNeeded: 26 }),
        seqEntry('C4', 5, 10, { budgetTokensNeeded: 10 })
      ]),
      OPTS
    )
    expect('budget' in out).toBe(false)
  })

  it('is ABSENT when the finish stage cannot be located in the sequence', () => {
    const out = reduceSeasonOutlook(makePayload(), OPTS)
    expect('budget' in out).toBe(false)
  })

  it('reconciles the span budget against the sim forward spend', () => {
    const out = reduceSeasonOutlook(
      withSequence([
        seqEntry('C3', 5, 26, {
          budgetTokensNeeded: 20,
          targeted: true,
          variance: 6
        }),
        seqEntry('C4', 5, 10, { budgetTokensNeeded: 10 }),
        seqEntry('C5', 5, 99, { budgetTokensNeeded: 99, targeted: true })
      ]),
      OPTS
    )
    expect(out.finish!.pctIntoFinalStage).toBeCloseTo(0.6, 10)
    expect(out.budget).toEqual({
      targetBudgetTokens: 26,
      projectedSpendTokens: 530,
      projectedSpendVsBudgetTokens: 504,
      stagesWithTargets: 1
    })
    expect(out.projectedForwardSpend).toBe(530)
  })

  it('does not read a partial finish as under budget (adversarial review fix)', () => {
    // Pct-scaling the finish stage keeps the budget like-for-like with the stage outcome.
    const payload = withSequence([
      seqEntry('C3', 5, 150, { budgetTokensNeeded: 150, targeted: true }),
      seqEntry('C4', 5, 100, { budgetTokensNeeded: 100, targeted: true })
    ])
    payload.plan.metrics.tokensSpent = 200
    payload.plan.finalRaidState.encounters[0].remainingHp = 600_000

    const out = reduceSeasonOutlook(payload, OPTS)
    expect(out.finish!.pctIntoFinalStage).toBeCloseTo(0.4, 10)
    expect(out.budget).toEqual({
      targetBudgetTokens: 190,
      projectedSpendTokens: 200,
      projectedSpendVsBudgetTokens: 10,
      stagesWithTargets: 2
    })
    expect(out.budget!.projectedSpendVsBudgetTokens).toBeGreaterThanOrEqual(0)
    expect(out.budget!.projectedSpendVsBudgetTokens).not.toBe(200 - 250)
  })

  it('stays absent when the sim suppressed the finish (no spend modelled)', () => {
    const payload = withSequence([
      seqEntry('C3', 5, 26, { budgetTokensNeeded: 20, targeted: true })
    ])
    payload.plan.metrics.tokensSpent = 0
    const out = reduceSeasonOutlook(payload, OPTS)
    expect(out.finish).toBeNull()
    expect('budget' in out).toBe(false)
  })
})

describe('deriveConfidence', () => {
  it('low without a finish or with thin data', () => {
    expect(
      deriveConfidence({ memberCount: 30, tokensUsed: 200, hasFinish: false })
    ).toBe('low')
    expect(
      deriveConfidence({ memberCount: 4, tokensUsed: 200, hasFinish: true })
    ).toBe('low')
    expect(
      deriveConfidence({ memberCount: 30, tokensUsed: 5, hasFinish: true })
    ).toBe('low')
  })
  it('medium for a partial roster / early season', () => {
    expect(
      deriveConfidence({ memberCount: 8, tokensUsed: 200, hasFinish: true })
    ).toBe('medium')
    expect(
      deriveConfidence({ memberCount: 30, tokensUsed: 40, hasFinish: true })
    ).toBe('medium')
  })
  it('high for a full roster with plenty of attacks', () => {
    expect(
      deriveConfidence({ memberCount: 30, tokensUsed: 200, hasFinish: true })
    ).toBe('high')
  })
})

import { describe, expect, it } from 'vitest'
import {
  diffStrategySummaries,
  rankInvestmentRecommendations,
  rankOptimizerCandidates,
  summarizeMemberContributions,
  summarizePlannerResult,
  type InvestmentDemand,
  type InvestmentHeroState,
  type StrategyOptimizerCandidate,
  type StrategyPlanSummary
} from '@/app/lib/boss-assignments/season-planner/roster-strategy-core'
import type { PlannerResult } from '@/app/lib/boss-assignments/season-planner/planner-engine'

const makeResult = (): PlannerResult => ({
  sessions: [
    {
      at: '2026-07-08T00:00:00.000Z',
      playerId: 'p1',
      playerDisplayName: 'Player One',
      tokensAvailable: 3,
      tokensSpent: 2,
      tokensHeld: 1,
      actions: [
        {
          type: 'token_attack',
          at: '2026-07-08T00:00:00.000Z',
          playerId: 'p1',
          stageCode: 'L1',
          loopIndex: 0,
          encounterId: 0,
          bossName: 'Boss A',
          expectedDamage: 100,
          appliedDamage: 90,
          overkillDamage: 10
        },
        {
          type: 'token_attack',
          at: '2026-07-08T00:00:00.000Z',
          playerId: 'p1',
          stageCode: 'L1',
          loopIndex: 0,
          encounterId: 1,
          bossName: 'Boss A Prime',
          expectedDamage: 80,
          appliedDamage: 80,
          overkillDamage: 0
        }
      ]
    },
    {
      at: '2026-07-08T01:00:00.000Z',
      playerId: 'p2',
      playerDisplayName: 'Player Two',
      tokensAvailable: 3,
      tokensSpent: 1,
      tokensHeld: 2,
      actions: [
        {
          type: 'token_attack',
          at: '2026-07-08T01:00:00.000Z',
          playerId: 'p2',
          stageCode: 'L1',
          loopIndex: 0,
          encounterId: 0,
          bossName: 'Boss A',
          expectedDamage: 50,
          appliedDamage: 50,
          overkillDamage: 0
        }
      ]
    }
  ],
  finalRaidState: {
    stageCode: 'L2',
    loopIndex: 0,
    encounters: {
      0: {
        encounterId: 0,
        stageCode: 'L2',
        loopIndex: 0,
        bossName: 'Boss B',
        maxHp: 100,
        remainingHp: 100
      },
      1: {
        encounterId: 1,
        stageCode: 'L2',
        loopIndex: 0,
        bossName: 'Boss B Prime 1',
        maxHp: 0,
        remainingHp: 0
      },
      2: {
        encounterId: 2,
        stageCode: 'L2',
        loopIndex: 0,
        bossName: 'Boss B Prime 2',
        maxHp: 0,
        remainingHp: 0
      }
    }
  },
  metrics: {
    tokensSpent: 3,
    overkillDamage: 10,
    bossesDefeated: 1,
    loopAdvances: 0,
    wastedTokens: 0,
    wastedTicks: 0
  },
  warnings: []
})

const summary = (overrides: Partial<StrategyPlanSummary> = {}) =>
  ({
    guildCode: 'G1',
    memberCount: 2,
    tokensSpent: 10,
    tokensHeld: 0,
    wastedTokens: 1,
    bossesDefeated: 2,
    loopAdvances: 0,
    appliedDamage: 1_000_000,
    expectedDamage: 1_000_000,
    overkillDamage: 0,
    tokenEfficiency: 100_000,
    finalStageCode: 'L3',
    finalLoopIndex: 0,
    tokensRemainingSpendable: 40,
    ...overrides
  }) satisfies StrategyPlanSummary

describe('roster strategy core', () => {
  it('summarizes planner damage and per-member contributions', () => {
    const result = makeResult()
    const planSummary = summarizePlannerResult({
      guildCode: 'G1',
      memberCount: 2,
      result,
      tokensRemainingSpendable: 42
    })

    expect(planSummary.appliedDamage).toBe(220)
    expect(planSummary.expectedDamage).toBe(230)
    expect(planSummary.tokenEfficiency).toBe(73)
    expect(planSummary.tokensRemainingSpendable).toBe(42)

    const contributions = summarizeMemberContributions(result.sessions)
    expect(contributions.map((entry) => entry.playerId)).toEqual(['p2', 'p1'])
    expect(contributions[0]).toMatchObject({
      displayName: 'Player Two',
      tokensSpent: 1,
      appliedDamage: 50
    })
  })

  it('scores boss-clear and efficiency improvements ahead of raw token spend', () => {
    const baseline = summary()
    const projected = summary({
      bossesDefeated: 3,
      tokenEfficiency: 140_000,
      appliedDamage: 1_600_000,
      wastedTokens: 0
    })

    const delta = diffStrategySummaries(projected, baseline)

    expect(delta.bossesDefeated).toBe(1)
    expect(delta.tokenEfficiency).toBe(40_000)
    expect(delta.score).toBeGreaterThan(1_000)
  })

  it('ranks optimizer candidates by projection delta before fit damage', () => {
    const base = summary()
    const candidate = (
      id: string,
      score: number,
      fitDamage: number
    ): StrategyOptimizerCandidate => ({
      candidatePlayerId: id,
      candidateDisplayName: id,
      candidateGuildCode: 'G2',
      replacedPlayerId: 'out',
      replacedDisplayName: 'Outgoing',
      baseline: base,
      projected: base,
      delta: {
        tokensSpent: 0,
        wastedTokens: 0,
        bossesDefeated: 0,
        loopAdvances: 0,
        appliedDamage: 0,
        expectedDamage: 0,
        overkillDamage: 0,
        tokenEfficiency: 0,
        score
      },
      fitDamage,
      sampleCount: 4,
      reasons: []
    })

    expect(
      rankOptimizerCandidates(
        [candidate('lower-score', 2, 999), candidate('higher-score', 3, 10)],
        1
      )[0]?.candidatePlayerId
    ).toBe('higher-score')
  })

  it('ranks owned hero investment demand and emits the requested next step', () => {
    const hero: InvestmentHeroState = {
      heroName: 'Eldryon',
      unitId: 'eldryon',
      category: 'hero',
      rankName: 'Gold I',
      rankIndex: 12,
      activeAbility: 35,
      passiveAbility: 35,
      progressionIndex: 12,
      stars: 4
    }
    const demand: InvestmentDemand[] = [
      {
        heroName: 'Eldryon',
        unitId: 'eldryon',
        bossName: 'Avatar',
        raritySet: 'L5',
        damageP90: 1_000_000,
        attackCount: 50
      }
    ]

    const ranked = rankInvestmentRecommendations({
      playerId: 'p1',
      displayName: 'Player One',
      heroStates: [hero],
      demand,
      resolveState: () => 'Weak',
      describeNextStep: () => 'Raise Eldryon to Diamond III.',
      limit: 3
    })

    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toMatchObject({
      heroName: 'Eldryon',
      state: 'Weak',
      recommendation: 'Raise Eldryon to Diamond III.'
    })
    expect(ranked[0]?.priorityScore).toBeGreaterThan(1_000_000)
  })
})

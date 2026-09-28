import { describe, expect, it } from 'vitest'

import { orchestrateMultiStage } from '@/app/lib/boss-assignments/unified-orchestrator'
import {
  buildDamageModel,
  type DamageRecord
} from '@/app/lib/boss-assignments/season-planner/damage-model'
import type { ClassifiedPlayer } from '@/app/lib/boss-assignments/player-classifier'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

const REFERENCE_AT = '2026-04-24T00:00:00.000Z'
const RECENT_BATTLE = '2026-04-22T12:00:00.000Z'

const damageRecords: DamageRecord[] = [
  {
    playerId: 'p1',
    bossName: 'Magnus',
    encounterId: 0,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 2_000_000
  },
  {
    playerId: 'p1',
    bossName: 'Thaumacus',
    encounterId: 1,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_500_000
  },
  {
    playerId: 'p1',
    bossName: 'Abraxas',
    encounterId: 2,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_500_000
  },
  {
    playerId: 'p2',
    bossName: 'Magnus',
    encounterId: 0,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_500_000
  },
  {
    playerId: 'p2',
    bossName: 'Thaumacus',
    encounterId: 1,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_200_000
  },
  {
    playerId: 'p3',
    bossName: 'Magnus',
    encounterId: 0,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_000_000
  },
  {
    playerId: 'p3',
    bossName: 'Thaumacus',
    encounterId: 1,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 800_000
  },
  {
    playerId: 'p4',
    bossName: 'Magnus',
    encounterId: 0,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 800_000
  },
  {
    playerId: 'p4',
    bossName: 'Thaumacus',
    encounterId: 1,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 600_000
  }
]

const damageModel = buildDamageModel(damageRecords, {
  referenceAt: REFERENCE_AT
})

const classifiedPlayers: ClassifiedPlayer[] = [
  {
    playerId: 'p1',
    displayName: 'P1',
    tier: 'strong',
    overallAvgDamage: 1_800_000,
    avgDamageByStage: { L4: 2_000_000 }
  },
  {
    playerId: 'p2',
    displayName: 'P2',
    tier: 'mid',
    overallAvgDamage: 1_400_000,
    avgDamageByStage: { L4: 1_500_000 }
  },
  {
    playerId: 'p3',
    displayName: 'P3',
    tier: 'mid',
    overallAvgDamage: 900_000,
    avgDamageByStage: { L4: 1_000_000 }
  },
  {
    playerId: 'p4',
    displayName: 'P4',
    tier: 'developing',
    overallAvgDamage: 700_000,
    avgDamageByStage: { L4: 800_000 }
  },
  {
    playerId: 'p_silent',
    displayName: 'PSilent',
    tier: 'developing',
    overallAvgDamage: 0,
    avgDamageByStage: {}
  }
]

// L4 has damage records; M2 has none (null propagation). Main HP exceeds 3 tokens.
const bossSequence: BossStageEntry[] = [
  {
    stageCode: 'L4',
    loopIndex: 0,
    difficulty: 'medium',
    estimatedTokensNeeded: 15,
    isCurrentStage: true,
    encounters: {
      main: {
        bossName: 'Magnus',
        bossType: 'Magnus',
        maxHp: 20_000_000,
        remainingHp: 20_000_000
      },
      prime1: {
        bossName: 'Thaumacus',
        bossType: 'Thaumacus',
        maxHp: 4_000_000,
        remainingHp: 4_000_000
      },
      prime2: {
        bossName: 'Abraxas',
        bossType: 'Abraxas',
        maxHp: 4_000_000,
        remainingHp: 4_000_000
      }
    }
  }
]

const ghostSequence: BossStageEntry[] = [
  {
    stageCode: 'M2',
    loopIndex: 0,
    difficulty: 'hard',
    estimatedTokensNeeded: 12,
    isCurrentStage: true,
    encounters: {
      main: {
        bossName: 'GhostBoss',
        bossType: 'GhostBoss',
        maxHp: 10_000_000,
        remainingHp: 10_000_000
      },
      prime1: {
        bossName: 'GhostPrime1',
        bossType: 'GhostPrime1',
        maxHp: 3_000_000,
        remainingHp: 3_000_000
      },
      prime2: {
        bossName: 'GhostPrime2',
        bossType: 'GhostPrime2',
        maxHp: 3_000_000,
        remainingHp: 3_000_000
      }
    }
  }
]

const playerTokens: Record<string, number> = {
  p1: 20,
  p2: 20,
  p3: 20,
  p4: 20,
  p_silent: 20
}

describe('orchestrateMultiStage — invariants locked by the multi-stage review', () => {
  it('solves primes (priorityRank=0) before main (priorityRank=1) within a stage', () => {
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence,
      damageModel
    })

    expect(result.stageAssignments).toHaveLength(1)
    const stage = result.stageAssignments[0]!

    const prime1Coverage = stage.solverResult.coverage['L4_prime1']
    const prime2Coverage = stage.solverResult.coverage['L4_prime2']
    const mainCoverage = stage.solverResult.coverage['L4_main']

    expect(prime1Coverage).toBeDefined()
    expect(prime2Coverage).toBeDefined()
    expect(mainCoverage).toBeDefined()

    expect(prime1Coverage!.percentage).toBeGreaterThanOrEqual(
      mainCoverage!.percentage - 0.0001
    )
    expect(prime2Coverage!.percentage).toBeGreaterThanOrEqual(
      mainCoverage!.percentage - 0.0001
    )
  })

  it('enforces MAX_TOKENS_PER_PLAYER_PER_BOSS=3 on every (player, boss) pair', () => {
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence,
      damageModel
    })

    const perEdge = new Map<string, number>()
    for (const sa of result.stageAssignments) {
      for (const a of sa.assignments) {
        const key = `${a.playerId}::${a.bossId}`
        perEdge.set(key, (perEdge.get(key) ?? 0) + a.tokens)
      }
    }

    for (const [, tokens] of perEdge) {
      expect(tokens).toBeLessThanOrEqual(3)
    }
  })

  it('omits null-expected-damage players from score edges (p_silent on ghost boss)', () => {
    // p_silent misses every fallback tier, so its edge is omitted, not fabricated.
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence: ghostSequence,
      damageModel
    })

    expect(result.stageAssignments).toHaveLength(1)
    const stage = result.stageAssignments[0]!

    const silentAssignments = stage.assignments.filter(
      (a) => a.playerId === 'p_silent'
    )
    expect(silentAssignments).toHaveLength(0)
    expect(result.playerBudgets['p_silent']?.allocated).toBe(0)

    // Null exclusion is per player, not a stage shutdown.
    const realAttackerIds = new Set(
      stage.assignments.filter((a) => a.tokens > 0).map((a) => a.playerId)
    )
    expect(realAttackerIds.size).toBeGreaterThan(0)
    expect(realAttackerIds.has('p_silent')).toBe(false)
  })

  it('distributes main-boss tokens across multiple attackers when requiredTokens > 3', () => {
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence,
      damageModel
    })

    const stage = result.stageAssignments[0]!
    const mainAttackers = new Set(
      stage.assignments
        .filter((a) => a.bossId === 'L4_main' && a.tokens > 0)
        .map((a) => a.playerId)
    )

    expect(mainAttackers.size).toBeGreaterThanOrEqual(3)
  })

  it('projects per-encounter HP from assignments (Issue 3)', () => {
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence,
      damageModel
    })

    const stage = result.stageAssignments[0]!

    expect(stage.projections.main.startingHp).toBe(20_000_000)
    expect(stage.projections.prime1!.startingHp).toBe(4_000_000)

    expect(stage.projections.main.projectedDamage).toBeGreaterThan(0)
    expect(stage.projections.main.projectedRemainingHp).toBeGreaterThanOrEqual(
      0
    )
    expect(stage.projections.main.tokensPlanned).toBeGreaterThan(0)
  })
})

describe('orchestrateMultiStage — time-phased token cap', () => {
  // A generous season budget so only the physical cap binds.
  const twoStageSequence: BossStageEntry[] = [
    {
      stageCode: 'L4',
      loopIndex: 0,
      difficulty: 'medium',
      estimatedTokensNeeded: 6,
      isCurrentStage: true,
      encounters: {
        main: {
          bossName: 'Magnus',
          bossType: 'Magnus',
          maxHp: 5_000_000,
          remainingHp: 5_000_000
        },
        prime1: null,
        prime2: null
      }
    },
    {
      stageCode: 'L5',
      loopIndex: 0,
      difficulty: 'medium',
      estimatedTokensNeeded: 6,
      isCurrentStage: false,
      encounters: {
        main: {
          bossName: 'Magnus',
          bossType: 'Magnus',
          maxHp: 5_000_000,
          remainingHp: 5_000_000
        },
        prime1: null,
        prime2: null
      }
    }
  ]

  const generousBudget: Record<string, number> = {
    p1: 30,
    p2: 30,
    p3: 30,
    p4: 30,
    p_silent: 30
  }

  it('enforces physical cap = currentTokens at stage 0 (startSeconds=0)', () => {
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens: generousBudget,
      bossSequence: [twoStageSequence[0]!],
      damageModel,
      currentTokensByPlayer: { p1: 1, p2: 1, p3: 1, p4: 1, p_silent: 1 },
      stageStartSecondsByIndex: [0]
    })

    const stage = result.stageAssignments[0]!
    const perPlayer: Record<string, number> = {}
    for (const a of stage.assignments) {
      perPlayer[a.playerId] = (perPlayer[a.playerId] ?? 0) + a.tokens
    }
    for (const [playerId, tokens] of Object.entries(perPlayer)) {
      expect(
        tokens,
        `player ${playerId} should not exceed physical cap`
      ).toBeLessThanOrEqual(1)
    }
  })

  it('regen accrues across stages — 24h gap gives +2 tokens, capped at MAX_TOKENS=3', () => {
    // Stage 0 cap is 0; stage 1 (t=24h) cap is min(3, 0 + 2) = 2.
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens: generousBudget,
      bossSequence: twoStageSequence,
      damageModel,
      currentTokensByPlayer: { p1: 0, p2: 0, p3: 0, p4: 0, p_silent: 0 },
      stageStartSecondsByIndex: [0, 24 * 60 * 60]
    })

    const stage0 = result.stageAssignments.find((s) => s.stageCode === 'L4')
    const stage1 = result.stageAssignments.find((s) => s.stageCode === 'L5')

    expect(stage0?.assignments ?? []).toHaveLength(0)

    expect(stage1).toBeDefined()
    const perPlayer1: Record<string, number> = {}
    for (const a of stage1!.assignments) {
      perPlayer1[a.playerId] = (perPlayer1[a.playerId] ?? 0) + a.tokens
    }
    for (const [playerId, tokens] of Object.entries(perPlayer1)) {
      expect(tokens, `player ${playerId} stage1 cap`).toBeLessThanOrEqual(2)
    }
  })

  it('falls back to scalar season budget when physical-cap inputs are absent (back-compat)', () => {
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens: generousBudget,
      bossSequence: [twoStageSequence[0]!],
      damageModel
    })

    expect(result.stageAssignments).toHaveLength(1)
    expect(result.stageAssignments[0]!.assignments.length).toBeGreaterThan(0)
  })
})

describe('orchestrateMultiStage — officer-target allocation caps', () => {
  // The solver's ceiling is max(requiredTokens, minTokens), so both are clamped.
  const withBudget = (
    budgets: Partial<
      Record<
        'main' | 'prime1' | 'prime2',
        {
          budgetTokens: number
          budgetSource: 'officer_target' | 'model_estimate'
        }
      >
    >
  ): BossStageEntry[] => {
    const cloned = structuredClone(bossSequence)
    const encounters = cloned[0]!.encounters
    if (budgets.main) Object.assign(encounters.main, budgets.main)
    if (budgets.prime1 && encounters.prime1)
      Object.assign(encounters.prime1, budgets.prime1)
    if (budgets.prime2 && encounters.prime2)
      Object.assign(encounters.prime2, budgets.prime2)
    return cloned
  }

  it('caps allocation at a binding officer target and surfaces the shortfall', () => {
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence: withBudget({
        main: { budgetTokens: 5, budgetSource: 'officer_target' }
      }),
      damageModel
    })

    const stage = result.stageAssignments[0]!
    expect(stage.solverResult.coverage['L4_main']!.required).toBe(5)
    const mainTokens = stage.assignments
      .filter((a) => a.bossId === 'L4_main')
      .reduce((s, a) => s + a.tokens, 0)
    expect(mainTokens).toBeLessThanOrEqual(5)

    expect(stage.targetCaps).toBeDefined()
    expect(stage.targetCaps).toHaveLength(1)
    const cap = stage.targetCaps![0]!
    expect(cap).toMatchObject({
      bossId: 'L4_main',
      encounter: 'main',
      capTokens: 5
    })
    expect(cap.modelTokensNeeded).toBeGreaterThan(5)
    expect(cap.shortfallTokens).toBe(cap.modelTokensNeeded - 5)
  })

  it('does NOT bind (and reports nothing) when the target exceeds the model demand', () => {
    const baseline = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence,
      damageModel
    })
    const generous = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence: withBudget({
        main: { budgetTokens: 500, budgetSource: 'officer_target' }
      }),
      damageModel
    })

    expect(generous.stageAssignments[0]!.targetCaps).toBeUndefined()
    expect(generous.stageAssignments).toStrictEqual(baseline.stageAssignments)
  })

  it('ignores model_estimate-sourced budgets entirely (target-less identity)', () => {
    const baseline = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence,
      damageModel
    })
    const modelBudget = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence: withBudget({
        main: { budgetTokens: 5, budgetSource: 'model_estimate' }
      }),
      damageModel
    })

    expect(modelBudget.stageAssignments[0]!.targetCaps).toBeUndefined()
    expect(modelBudget.stageAssignments).toStrictEqual(
      baseline.stageAssignments
    )
  })

  it('a target below minTokensPerBoss wins over the floor (officer intent)', () => {
    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence: withBudget({
        prime1: { budgetTokens: 1, budgetSource: 'officer_target' }
      }),
      damageModel
    })

    const stage = result.stageAssignments[0]!
    expect(stage.solverResult.coverage['L4_prime1']!.required).toBe(1)
    const prime1Tokens = stage.assignments
      .filter((a) => a.bossId === 'L4_prime1')
      .reduce((s, a) => s + a.tokens, 0)
    expect(prime1Tokens).toBeLessThanOrEqual(1)
    expect(
      stage.targetCaps!.some(
        (c) => c.bossId === 'L4_prime1' && c.capTokens === 1
      )
    ).toBe(true)
  })
})

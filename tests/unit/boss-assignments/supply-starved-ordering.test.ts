import { describe, expect, it } from 'vitest'

import { orchestrateMultiStage } from '@/app/lib/boss-assignments/unified-orchestrator'
import {
  buildDamageModel,
  type DamageRecord
} from '@/app/lib/boss-assignments/season-planner/damage-model'
import type { ClassifiedPlayer } from '@/app/lib/boss-assignments/player-classifier'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

/** Supply is below demand: primes (rank 0) reach ~100% and the main starves. */

const REFERENCE_AT = '2026-04-24T00:00:00.000Z'
const RECENT_BATTLE = '2026-04-22T12:00:00.000Z'

const PLAYER_IDS = ['p1', 'p2'] as const

const PLAYER_TOKENS: Record<string, number> = { p1: 3, p2: 3 }

const damageRecords: DamageRecord[] = [
  {
    playerId: 'p1',
    bossName: 'Magnus',
    encounterId: 0,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_000_000
  },
  {
    playerId: 'p1',
    bossName: 'Thaumacus',
    encounterId: 1,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_000_000
  },
  {
    playerId: 'p1',
    bossName: 'Abraxas',
    encounterId: 1,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_000_000
  },
  {
    playerId: 'p2',
    bossName: 'Magnus',
    encounterId: 0,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_000_000
  },
  {
    playerId: 'p2',
    bossName: 'Thaumacus',
    encounterId: 1,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_000_000
  },
  {
    playerId: 'p2',
    bossName: 'Abraxas',
    encounterId: 1,
    rarity: 'Legendary',
    set: 3,
    startedOn: RECENT_BATTLE,
    damageDealt: 1_000_000
  }
]

const damageModel = buildDamageModel(damageRecords, {
  referenceAt: REFERENCE_AT
})

const players: ClassifiedPlayer[] = PLAYER_IDS.map((id) => ({
  playerId: id,
  displayName: id.toUpperCase(),
  tier: 'mid' as const,
  overallAvgDamage: 1_000_000,
  avgDamageByStage: { L4: 1_000_000 }
}))

// ~1M/token: primes need 2 tokens each, the main ~58; supply is 6.
const starvedSequence: BossStageEntry[] = [
  {
    stageCode: 'L4',
    loopIndex: 0,
    difficulty: 'medium',
    estimatedTokensNeeded: 0,
    isCurrentStage: true,
    encounters: {
      main: {
        bossName: 'Magnus',
        bossType: 'Magnus',
        maxHp: 40_000_000,
        remainingHp: 40_000_000
      },
      prime1: {
        bossName: 'Thaumacus',
        bossType: 'Thaumacus',
        maxHp: 1_400_000,
        remainingHp: 1_400_000
      },
      prime2: {
        bossName: 'Abraxas',
        bossType: 'Abraxas',
        maxHp: 1_400_000,
        remainingHp: 1_400_000
      }
    }
  }
]

describe('supply-starved ordering — primes win scarce tokens before the main', () => {
  const result = orchestrateMultiStage({
    players,
    playerTokens: PLAYER_TOKENS,
    bossSequence: starvedSequence,
    damageModel
  })

  it('the fixture is genuinely supply-starved (supply < main+prime demand)', () => {
    // Assert scarcity up front, or the ordering test is vacuous.
    expect(result.stageAssignments).toHaveLength(1)
    const cov = result.stageAssignments[0]!.solverResult.coverage
    const totalDemand =
      (cov['L4_main']?.required ?? 0) +
      (cov['L4_prime1']?.required ?? 0) +
      (cov['L4_prime2']?.required ?? 0)
    const totalSupply = PLAYER_TOKENS.p1 + PLAYER_TOKENS.p2
    expect(totalSupply).toBeLessThan(totalDemand)
  })

  it('both primes reach 100% coverage', () => {
    const cov = result.stageAssignments[0]!.solverResult.coverage
    const prime1 = cov['L4_prime1']
    const prime2 = cov['L4_prime2']
    expect(prime1).toBeDefined()
    expect(prime2).toBeDefined()
    expect(prime1!.percentage).toBeGreaterThanOrEqual(100)
    expect(prime2!.percentage).toBeGreaterThanOrEqual(100)
    expect(prime1!.gap).toBe(0)
    expect(prime2!.gap).toBe(0)
  })

  it('the main is STARVED (coverage < 100%, positive gap)', () => {
    const cov = result.stageAssignments[0]!.solverResult.coverage
    const main = cov['L4_main']
    expect(main).toBeDefined()
    expect(main!.percentage).toBeLessThan(100)
    expect(main!.gap).toBeGreaterThan(0)
  })

  it('primes are at least as covered as the main (rank-order invariant)', () => {
    const cov = result.stageAssignments[0]!.solverResult.coverage
    const main = cov['L4_main']!
    const prime1 = cov['L4_prime1']!
    const prime2 = cov['L4_prime2']!
    expect(prime1.percentage).toBeGreaterThan(main.percentage)
    expect(prime2.percentage).toBeGreaterThan(main.percentage)
  })

  it('total assigned tokens never exceed total supply (conservation)', () => {
    const stage = result.stageAssignments[0]!
    const assigned = stage.assignments.reduce((sum, a) => sum + a.tokens, 0)
    expect(assigned).toBeGreaterThan(0)
    expect(assigned).toBeLessThanOrEqual(PLAYER_TOKENS.p1 + PLAYER_TOKENS.p2)
  })
})

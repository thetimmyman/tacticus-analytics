import { describe, it, expect, vi } from 'vitest'
import {
  buildDamageModel,
  computeMeanDamagePerBattle,
  computeRosterEncounterDamagePerToken,
  type DamageRecord
} from '@/app/lib/boss-assignments/season-planner/damage-model'
import { computeRemainingBossSequence } from '@/app/lib/boss-assignments/season-sequence'
import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'
import type { SeasonBoss } from '@/app/lib/loki/season-configs'
import type { BossHpData } from '@/app/lib/boss-assignments/season-planner/boss-hp'

describe('computeMeanDamagePerBattle', () => {
  it('returns 0 for an empty record set', () => {
    expect(computeMeanDamagePerBattle([])).toBe(0)
  })

  it('returns the plain unweighted mean (WI-2430 formula)', () => {
    expect(
      computeMeanDamagePerBattle([
        { damageDealt: 100 },
        { damageDealt: 200 },
        { damageDealt: 600 }
      ])
    ).toBe(300)
  })
})

describe('computeRemainingBossSequence difficulty with a real guild average', () => {
  const progressionConfig: ProgressionConfig = {
    firstPassSequence: ['L1', 'L2', 'L3'],
    loopSequence: ['L1', 'L2', 'L3'],
    loopStartStage: 'L1',
    gameVersion: null
  }

  const mainBoss = (stageCode: 'L1' | 'L2' | 'L3'): SeasonBoss => ({
    boss_type: `TestBoss${stageCode}`,
    boss_name: `TestBoss${stageCode}`,
    set: Number.parseInt(stageCode.slice(1), 10) - 1,
    encounter_id: 0,
    rarity: 'Legendary',
    canonical: `TestBoss${stageCode}`
  })
  const seasonBosses: SeasonBoss[] = [
    mainBoss('L1'),
    mainBoss('L2'),
    mainBoss('L3')
  ]

  // At avg 100: L1 = 3 tokens (easy), L2 = 30 (medium), L3 = 1000 (hard).
  const bossHpData: BossHpData = {
    legendary: { L1: 300, L2: 3_000, L3: 100_000 },
    mythic: {},
    primes: {},
    byBossName: {}
  }

  const baseArgs = {
    progressionConfig,
    currentStageCode: 'L1',
    currentLoopIndex: 0,
    seasonBosses,
    bossHpData,
    maxStages: 3
  }

  it('produces mixed difficulties and non-zero token estimates', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      guildAvgDamage: 100
    })

    expect(sequence.map((s) => s.stageCode)).toEqual(['L1', 'L2', 'L3'])
    expect(sequence.map((s) => s.difficulty)).toEqual([
      'easy',
      'medium',
      'hard'
    ])
    expect(sequence.map((s) => s.estimatedTokensNeeded)).toEqual([3, 30, 1000])
  })

  it('degrades to all-hard / zero-estimate with a zero average (the old bug)', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      guildAvgDamage: 0
    })

    expect(sequence).toHaveLength(3)
    expect(sequence.every((s) => s.difficulty === 'hard')).toBe(true)
    expect(sequence.every((s) => s.estimatedTokensNeeded === 0)).toBe(true)
  })

  it('feeds computeMeanDamagePerBattle output straight into the sequence', () => {
    const guildAvgDamage = computeMeanDamagePerBattle([
      { damageDealt: 50 },
      { damageDealt: 150 }
    ])
    expect(guildAvgDamage).toBe(100)

    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      guildAvgDamage
    })
    expect(sequence.map((s) => s.difficulty)).toEqual([
      'easy',
      'medium',
      'hard'
    ])
  })
})

describe('computeRemainingBossSequence skip + roster-divisor semantics (WI-4500)', () => {
  const progressionConfig: ProgressionConfig = {
    firstPassSequence: ['L1', 'L2'],
    loopSequence: ['L1', 'L2'],
    loopStartStage: 'L1',
    gameVersion: null
  }

  const mainBoss = (stageCode: 'L1' | 'L2'): SeasonBoss => ({
    boss_type: `TestBoss${stageCode}`,
    boss_name: `TestBoss${stageCode}`,
    set: Number.parseInt(stageCode.slice(1), 10) - 1,
    encounter_id: 0,
    rarity: 'Legendary',
    canonical: `TestBoss${stageCode}`
  })
  const primeBoss = (
    stageCode: 'L1' | 'L2',
    encounterId: 1 | 2
  ): SeasonBoss => ({
    boss_type: 'Avatar',
    boss_name: 'Avatar',
    set: Number.parseInt(stageCode.slice(1), 10) - 1,
    encounter_id: encounterId,
    rarity: 'Legendary',
    canonical: 'Avatar'
  })
  const seasonBosses: SeasonBoss[] = [
    mainBoss('L1'),
    primeBoss('L1', 1),
    primeBoss('L1', 2),
    mainBoss('L2')
  ]

  const bossHpData: BossHpData = {
    legendary: { L1: 300, L2: 3_000 },
    mythic: {},
    primes: { Avatar_L1: 100, Avatar_prime2_L1: 100 },
    byBossName: {}
  }

  const baseArgs = {
    progressionConfig,
    currentStageCode: 'L1',
    currentLoopIndex: 0,
    seasonBosses,
    bossHpData,
    guildAvgDamage: 100,
    maxStages: 2
  }

  it('excludes a skipped prime from totalHp / estimatedTokensNeeded and marks the entry', () => {
    const unskipped = computeRemainingBossSequence({ ...baseArgs })
    expect(unskipped[0]!.estimatedTokensNeeded).toBe(5)
    expect(unskipped[0]!.encounters.prime1).toMatchObject({
      maxHp: 100,
      remainingHp: 100,
      skipped: false
    })

    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      skippedPrimes: new Map([['L1', new Set<1 | 2>([1])]])
    })
    expect(sequence[0]!.estimatedTokensNeeded).toBe(4)
    expect(sequence[0]!.encounters.prime1).toMatchObject({
      bossName: 'Avatar',
      maxHp: 0,
      remainingHp: 0,
      skipped: true
    })
    expect(sequence[0]!.encounters.prime2).toMatchObject({
      maxHp: 100,
      remainingHp: 100,
      skipped: false
    })
  })

  it('zeroes the current-stage remainingHp override for a skipped prime', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      skippedPrimes: new Map([['L1', new Set<1 | 2>([2])]]),
      currentStageHp: {
        mainRemainingHp: 250,
        prime1RemainingHp: 90,
        prime2RemainingHp: 60
      }
    })
    expect(sequence[0]!.encounters.prime2).toMatchObject({
      maxHp: 0,
      remainingHp: 0,
      skipped: true
    })
    expect(sequence[0]!.estimatedTokensNeeded).toBe(4)
    expect(sequence[0]!.encounters.prime1!.remainingHp).toBe(90)
  })

  it('prefers a positive encounterDamagePerToken with a per-encounter pooled fallback', () => {
    const encounterDamagePerToken = vi.fn(
      (target: { stageCode: string; encounterId: 0 | 1 | 2 }): number | null =>
        target.stageCode === 'L1' && target.encounterId === 0 ? 250 : null
    )
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      encounterDamagePerToken
    })
    expect(sequence[0]!.estimatedTokensNeeded).toBe(4)
    expect(sequence[0]!.difficulty).toBe('easy')
    expect(sequence[1]!.estimatedTokensNeeded).toBe(30)
    expect(sequence[1]!.difficulty).toBe('medium')
  })

  it('never consults the callback for a skipped (zeroed) encounter', () => {
    const seen: Array<{ stageCode: string; encounterId: 0 | 1 | 2 }> = []
    computeRemainingBossSequence({
      ...baseArgs,
      skippedPrimes: new Map([['L1', new Set<1 | 2>([1])]]),
      encounterDamagePerToken: (target) => {
        seen.push({
          stageCode: target.stageCode,
          encounterId: target.encounterId
        })
        return null
      }
    })
    expect(
      seen.filter((call) => call.stageCode === 'L1').map((c) => c.encounterId)
    ).toEqual([0, 2])
  })

  it('sums per-encounter ceilings instead of dividing by a blended mean (adversarial case)', () => {
    // Per-encounter divisors give 22; a blended mean gives 37.
    const heavyHp: BossHpData = {
      legendary: { L1: 100_000_000 },
      mythic: {},
      primes: { Avatar_L1: 1_000_000 },
      byBossName: {}
    }
    const sequence = computeRemainingBossSequence({
      progressionConfig,
      currentStageCode: 'L1',
      currentLoopIndex: 0,
      seasonBosses: [mainBoss('L1'), primeBoss('L1', 1)],
      bossHpData: heavyHp,
      guildAvgDamage: 2_750_000,
      maxStages: 1,
      encounterDamagePerToken: (target) =>
        target.encounterId === 0 ? 5_000_000 : 500_000
    })
    expect(sequence[0]!.estimatedTokensNeeded).toBe(22)
    expect(sequence[0]!.estimatedTokensNeeded).not.toBe(37)
    expect(sequence[0]!.difficulty).toBe('medium')
  })
})

describe('computeRemainingBossSequence officer-target budgets (WI-4530)', () => {
  const progressionConfig: ProgressionConfig = {
    firstPassSequence: ['L1', 'L2'],
    loopSequence: ['L1', 'L2'],
    loopStartStage: 'L1',
    gameVersion: null
  }
  const mainBoss = (stageCode: 'L1' | 'L2'): SeasonBoss => ({
    boss_type: `TestBoss${stageCode}`,
    boss_name: `TestBoss${stageCode}`,
    set: Number.parseInt(stageCode.slice(1), 10) - 1,
    encounter_id: 0,
    rarity: 'Legendary',
    canonical: `TestBoss${stageCode}`
  })
  const primeBoss = (
    stageCode: 'L1' | 'L2',
    encounterId: 1 | 2
  ): SeasonBoss => ({
    boss_type: 'Avatar',
    boss_name: 'Avatar',
    set: Number.parseInt(stageCode.slice(1), 10) - 1,
    encounter_id: encounterId,
    rarity: 'Legendary',
    canonical: 'Avatar'
  })
  const seasonBosses: SeasonBoss[] = [
    mainBoss('L1'),
    primeBoss('L1', 1),
    primeBoss('L1', 2),
    mainBoss('L2')
  ]
  const bossHpData: BossHpData = {
    legendary: { L1: 300, L2: 3_000 },
    mythic: {},
    primes: { Avatar_L1: 100, Avatar_prime2_L1: 100 },
    byBossName: {}
  }
  const baseArgs = {
    progressionConfig,
    currentStageCode: 'L1',
    currentLoopIndex: 0,
    seasonBosses,
    bossHpData,
    guildAvgDamage: 100,
    maxStages: 2
  }

  it('emits NO budget fields without officer targets — byte-identical shape (named review axis)', () => {
    const baseline = computeRemainingBossSequence({ ...baseArgs })
    const withUndefined = computeRemainingBossSequence({
      ...baseArgs,
      officerTargets: undefined
    })
    const withEmptyMap = computeRemainingBossSequence({
      ...baseArgs,
      officerTargets: new Map()
    })

    expect(withUndefined).toStrictEqual(baseline)
    expect(withEmptyMap).toStrictEqual(baseline)
    expect(JSON.stringify(withEmptyMap)).toBe(JSON.stringify(baseline))
    for (const entry of baseline) {
      expect('budgetTokensNeeded' in entry).toBe(false)
      expect('budgetVarianceTokens' in entry).toBe(false)
      expect('budgetTokens' in entry.encounters.main).toBe(false)
      expect('modelEstimateTokens' in entry.encounters.main).toBe(false)
    }
  })

  it('budgets the officer target where set and the model estimate elsewhere', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      officerTargets: new Map([['L1', new Map<0 | 1 | 2, number>([[0, 20]])]])
    })

    const l1 = sequence[0]!
    expect(l1.estimatedTokensNeeded).toBe(5)
    expect(l1.difficulty).toBe('easy')
    expect(l1.encounters.main).toMatchObject({
      budgetTokens: 20,
      budgetSource: 'officer_target',
      modelEstimateTokens: 3
    })
    expect(l1.encounters.prime1).toMatchObject({
      budgetTokens: 1,
      budgetSource: 'model_estimate',
      modelEstimateTokens: 1
    })
    expect(l1.budgetTokensNeeded).toBe(22)
    expect(l1.budgetVarianceTokens).toBe(-17)

    const l2 = sequence[1]!
    expect(l2.budgetTokensNeeded).toBe(30)
    expect('budgetVarianceTokens' in l2).toBe(false)
    expect(l2.encounters.main).toMatchObject({
      budgetTokens: 30,
      budgetSource: 'model_estimate'
    })
  })

  it('reports zero variance explicitly when the target matches the model', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      officerTargets: new Map([['L1', new Map<0 | 1 | 2, number>([[0, 3]])]])
    })
    expect(sequence[0]!.budgetVarianceTokens).toBe(0)
    expect(sequence[0]!.budgetTokensNeeded).toBe(5)
  })

  it("never budgets a skipped prime's target (skip interplay)", () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      skippedPrimes: new Map([['L1', new Set<1 | 2>([1])]]),
      officerTargets: new Map([
        [
          'L1',
          new Map<0 | 1 | 2, number>([
            [0, 2],
            [1, 7] // target on the SKIPPED prime — must not enter any budget
          ])
        ]
      ])
    })

    const l1 = sequence[0]!
    expect(l1.encounters.prime1).toMatchObject({ skipped: true })
    expect('budgetTokens' in l1.encounters.prime1!).toBe(false)
    expect(l1.budgetTokensNeeded).toBe(3)
    expect(l1.budgetVarianceTokens).toBe(1)
  })

  it('scales a current-stage target by the remaining-HP fraction', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      currentStageHp: {
        mainRemainingHp: 150,
        prime1RemainingHp: 100,
        prime2RemainingHp: 100
      },
      officerTargets: new Map([['L1', new Map<0 | 1 | 2, number>([[0, 20]])]])
    })
    expect(sequence[0]!.encounters.main).toMatchObject({
      budgetTokens: 10,
      budgetSource: 'officer_target',
      modelEstimateTokens: 2
    })
    expect(sequence[0]!.budgetTokensNeeded).toBe(12)
    expect(sequence[0]!.budgetVarianceTokens).toBe(-8)
  })

  it('clamps a glitched remainingHp > maxHp so the budget never exceeds the target', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      currentStageHp: {
        mainRemainingHp: 360,
        prime1RemainingHp: 100,
        prime2RemainingHp: 100
      },
      officerTargets: new Map([['L1', new Map<0 | 1 | 2, number>([[0, 20]])]])
    })
    // The fraction clamps at 1; unclamped would exceed the target.
    expect(sequence[0]!.encounters.main.budgetTokens).toBe(20)
    expect(sequence[0]!.encounters.main.budgetTokens).not.toBe(24)
    expect(sequence[0]!.encounters.main.modelEstimateTokens).toBe(4)
    expect(sequence[0]!.budgetTokensNeeded).toBe(22)
  })

  it('keeps the officer budget when the model has no signal, without variance', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      guildAvgDamage: 0,
      officerTargets: new Map([['L1', new Map<0 | 1 | 2, number>([[0, 20]])]])
    })
    const l1 = sequence[0]!
    expect(l1.estimatedTokensNeeded).toBe(0)
    expect(l1.difficulty).toBe('hard')
    expect(l1.encounters.main).toMatchObject({
      budgetTokens: 20,
      budgetSource: 'officer_target',
      modelEstimateTokens: null
    })
    expect(l1.budgetTokensNeeded).toBe(20)
    expect('budgetVarianceTokens' in l1).toBe(false)
  })

  it('does not let an aggressive target soften difficulty (stays model-driven)', () => {
    const sequence = computeRemainingBossSequence({
      ...baseArgs,
      officerTargets: new Map([['L2', new Map<0 | 1 | 2, number>([[0, 5]])]])
    })
    expect(sequence[1]!.estimatedTokensNeeded).toBe(30)
    expect(sequence[1]!.difficulty).toBe('medium')
    expect(sequence[1]!.budgetTokensNeeded).toBe(5)
    expect(sequence[1]!.budgetVarianceTokens).toBe(25)
  })
})

describe('computeRosterEncounterDamagePerToken', () => {
  // Shared timestamp: recency weights are 1, so averages are plain means.
  const AT = '2026-07-01T00:00:00.000Z'
  const record = (
    playerId: string,
    bossName: string,
    damageDealt: number,
    set = 0
  ): DamageRecord => ({
    playerId,
    bossName,
    encounterId: 0,
    rarity: 'Legendary',
    set,
    startedOn: AT,
    damageDealt
  })

  it('shifts the encounter estimate toward strong player_target signal vs the pooled mean', () => {
    const records = [
      record('p1', 'BossA', 1_000),
      record('p1', 'BossA', 1_000),
      record('p2', 'BossB', 100, 1)
    ]
    const model = buildDamageModel(records, { referenceAt: AT })

    const rosterEstimate = computeRosterEncounterDamagePerToken(
      model,
      ['p1', 'p2'],
      { stageCode: 'L1', encounterId: 0, bossName: 'BossA' }
    )
    expect(rosterEstimate).toBe(550)
    expect(computeMeanDamagePerBattle(records)).toBe(700)
  })

  it('excludes no_signal players instead of default-filling (WI-666)', () => {
    const model = buildDamageModel([record('p1', 'BossA', 1_000)], {
      referenceAt: AT
    })
    const estimate = computeRosterEncounterDamagePerToken(model, ['p1', 'p3'], {
      stageCode: 'L3',
      encounterId: 0,
      bossName: 'UnseenBoss'
    })
    expect(estimate).toBe(1_000)
  })

  it('returns null when no roster member has signal (per-encounter fallback trigger)', () => {
    const model = buildDamageModel([record('p1', 'BossA', 1_000)], {
      referenceAt: AT
    })
    const estimate = computeRosterEncounterDamagePerToken(model, ['p3', 'p4'], {
      stageCode: 'L3',
      encounterId: 0,
      bossName: 'UnseenBoss'
    })
    expect(estimate).toBeNull()
  })
})

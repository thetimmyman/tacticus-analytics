import { describe, it, expect } from 'vitest'
// Runs the real award math that ranks players; never re-implement it here.
import {
  calculatePlayerPointsFromAwards,
  calculateSetWinners
} from '@/app/components/votlw/utils/votlwCalculations'
import type {
  BattleEntry,
  SetWinner,
  SeasonResults
} from '@tacticus/app-core/votlw.types'

const makeSet = (overrides: Partial<SetWinner>): SetWinner => ({
  set: 0,
  rarity: 'Legendary',
  levelString: 'L1',
  bossName: 'Test Boss',
  gold: '',
  goldValue: 0,
  silver: '',
  silverValue: 0,
  bronze: '',
  bronzeValue: 0,
  mostDamage: '',
  mostDamageValue: 0,
  sideBoss1: '',
  sideBoss1Value: 0,
  sideBoss2: '',
  sideBoss2Value: 0,
  biggestHit: '',
  biggestHitValue: 0,
  ...overrides
})

const emptySeason = (): SeasonResults => ({
  topKiller: undefined,
  bestBomber: undefined,
  firstToken: { player: '', time: '' },
  lastToken: { player: '', time: '' },
  tokenEfficiency: { player: '', ratio: 0 },
  mostDamage: { player: '', damage: 0 },
  bombMaster: { player: '', bombs: 0 },
  legendarySlayer: { player: '', kills: 0 },
  sideBossSlayer: { player: '', kills: 0 },
  mostImproved: { player: '', improvementPct: 0 }
})

const blankStats = () => ({
  totalDamage: 0,
  effectiveTokenCount: 0,
  battleTokenCount: 0,
  sweepCount: 0,
  oneShotCount: 0,
  bombCount: 0,
  crashCount: 0
})

const makeBattle = (overrides: Partial<BattleEntry>): BattleEntry => ({
  Guild: 'EOT',
  Season: '86',
  displayName: 'Player',
  Name: 'Aethana',
  damageDealt: 1_000_000,
  damageType: 'Battle',
  remainingHp: 500_000,
  maxHp: 2_000_000,
  tier: 5,
  set: 0,
  loopIndex: 0,
  encounterId: 0,
  encounterIndex: 0,
  rarity: 'Legendary',
  startedOn: '2025-11-04T10:00:00Z',
  completedOn: '2025-11-04T10:05:00Z',
  ...overrides
})

describe('calculatePlayerPointsFromAwards — medal point table', () => {
  it('awards gold=3, silver=2, bronze=1', () => {
    const sets = [makeSet({ gold: 'Alpha', silver: 'Beta', bronze: 'Gamma' })]
    const result = calculatePlayerPointsFromAwards(sets, emptySeason(), {})

    const alpha = result.find((p) => p.displayName === 'Alpha')!
    const beta = result.find((p) => p.displayName === 'Beta')!
    const gamma = result.find((p) => p.displayName === 'Gamma')!

    expect(alpha.totalPoints).toBe(3)
    expect(alpha.awards.goldMedals).toBe(1)
    expect(beta.totalPoints).toBe(2)
    expect(beta.awards.silverMedals).toBe(1)
    expect(gamma.totalPoints).toBe(1)
    expect(gamma.awards.bronzeMedals).toBe(1)
  })

  it('awards mostDamage=1, sideBoss1/2=2 each, biggestHit=1', () => {
    const sets = [
      makeSet({
        mostDamage: 'Alpha',
        sideBoss1: 'Alpha',
        sideBoss2: 'Beta',
        biggestHit: 'Gamma'
      })
    ]
    const result = calculatePlayerPointsFromAwards(sets, emptySeason(), {})

    const alpha = result.find((p) => p.displayName === 'Alpha')!
    const beta = result.find((p) => p.displayName === 'Beta')!
    const gamma = result.find((p) => p.displayName === 'Gamma')!

    expect(alpha.totalPoints).toBe(3)
    expect(alpha.awards.mostDamageAwards).toBe(1)
    expect(alpha.awards.sideBoss1Wins).toBe(1)
    expect(beta.totalPoints).toBe(2)
    expect(beta.awards.sideBoss2Wins).toBe(1)
    expect(gamma.totalPoints).toBe(1)
    expect(gamma.awards.biggestHitAwards).toBe(1)
  })

  it('awards topKiller=+3 and bestBomber=+0.5 season bonuses', () => {
    const sets = [makeSet({ gold: 'Alpha' })]
    const season = emptySeason()
    season.topKiller = { player: 'Alpha', value: 9 }
    season.bestBomber = { player: 'Beta', value: 8_000_000 }

    const result = calculatePlayerPointsFromAwards(sets, season, {})
    const alpha = result.find((p) => p.displayName === 'Alpha')!
    const beta = result.find((p) => p.displayName === 'Beta')!

    expect(alpha.totalPoints).toBe(6)
    expect(alpha.awards.topKiller).toBe(true)
    expect(beta.totalPoints).toBe(0.5)
    expect(beta.awards.bestBomber).toBe(true)
  })

  it('resolves a points tie by token count, then by first token time', () => {
    const sets = [
      makeSet({ set: 0, levelString: 'L1', gold: 'Early' }),
      makeSet({ set: 1, levelString: 'L2', gold: 'Late' })
    ]

    const tiedTokens = calculatePlayerPointsFromAwards(sets, emptySeason(), {
      Early: {
        ...blankStats(),
        battleTokenCount: 5,
        firstTokenTime: '2025-11-04T08:00:00Z'
      },
      Late: {
        ...blankStats(),
        battleTokenCount: 5,
        firstTokenTime: '2025-11-04T20:00:00Z'
      }
    })
    expect(tiedTokens.map((p) => p.displayName)).toEqual(['Early', 'Late'])

    const tokenWins = calculatePlayerPointsFromAwards(sets, emptySeason(), {
      Early: {
        ...blankStats(),
        battleTokenCount: 5,
        firstTokenTime: '2025-11-04T08:00:00Z'
      },
      Late: {
        ...blankStats(),
        battleTokenCount: 9,
        firstTokenTime: '2025-11-04T20:00:00Z'
      }
    })
    expect(tokenWins.map((p) => p.displayName)).toEqual(['Late', 'Early'])
  })

  it('attaches avg damage / token / sweep / one-shot / bomb / crash stats', () => {
    const sets = [makeSet({ gold: 'Alpha' })]
    const result = calculatePlayerPointsFromAwards(sets, emptySeason(), {
      Alpha: {
        totalDamage: 10_000_001,
        effectiveTokenCount: 3,
        battleTokenCount: 4,
        sweepCount: 1,
        oneShotCount: 2,
        bombCount: 5,
        crashCount: 1,
        firstTokenTime: '2025-11-04T08:00:00Z'
      }
    })
    const alpha = result.find((p) => p.displayName === 'Alpha')!
    expect(alpha.avgDamagePerHit).toBe(3_333_334)
    expect(alpha.tokenCount).toBe(4)
    expect(alpha.sweeps).toBe(1)
    expect(alpha.oneShots).toBe(2)
    expect(alpha.bombsUsed).toBe(5)
    expect(alpha.crashes).toBe(1)
  })
})

describe('calculateSetWinners — qualification & ranking', () => {
  it('ranks medals by average damage descending', () => {
    const battles: BattleEntry[] = [
      makeBattle({ displayName: 'Grinder', damageDealt: 2_000_000 }),
      makeBattle({ displayName: 'Grinder', damageDealt: 2_000_000 }),
      makeBattle({ displayName: 'Grinder', damageDealt: 2_000_000 }),
      makeBattle({ displayName: 'Sniper', damageDealt: 3_000_000 }),
      makeBattle({ displayName: 'Sniper', damageDealt: 3_000_000 })
    ]

    const setL1 = calculateSetWinners(battles, new Set()).find(
      (s) => s.levelString === 'L1'
    )!

    // Gold = highest AVERAGE (Sniper) even though both total 6M.
    expect(setL1.gold).toBe('Sniper')
    expect(setL1.goldValue).toBe(3_000_000)
    expect(setL1.silver).toBe('Grinder')
    expect(setL1.silverValue).toBe(2_000_000)
    // mostDamage tracks TOTAL; tie at 6M broken by token count -> Grinder (3).
    expect(setL1.mostDamage).toBe('Grinder')
  })

  it('excludes a player whose only battle is a sweep (no meaningful battle)', () => {
    const battles: BattleEntry[] = [
      // A single last-hit sweep counts as zero meaningful battles.
      makeBattle({
        displayName: 'Sweeper',
        damageDealt: 50_000,
        remainingHp: 0,
        maxHp: 2_000_000
      }),
      makeBattle({ displayName: 'Real1', damageDealt: 1_000_000 }),
      makeBattle({ displayName: 'Real1', damageDealt: 1_200_000 }),
      makeBattle({ displayName: 'Real2', damageDealt: 700_000 }),
      makeBattle({ displayName: 'Real2', damageDealt: 700_000 })
    ]

    const setL1 = calculateSetWinners(battles, new Set()).find(
      (s) => s.levelString === 'L1'
    )!

    expect([setL1.gold, setL1.silver, setL1.bronze]).not.toContain('Sweeper')
    expect(setL1.gold).toBe('Real1')
    expect(setL1.silver).toBe('Real2')
  })

  it('excludes offenders from medal positions', () => {
    const battles: BattleEntry[] = [
      makeBattle({ displayName: 'Cheater', damageDealt: 9_000_000 }),
      makeBattle({ displayName: 'Cheater', damageDealt: 9_000_000 }),
      makeBattle({ displayName: 'Honest', damageDealt: 1_000_000 }),
      makeBattle({ displayName: 'Honest', damageDealt: 1_000_000 })
    ]

    const setL1 = calculateSetWinners(battles, new Set(['Cheater'])).find(
      (s) => s.levelString === 'L1'
    )!
    expect(setL1.gold).toBe('Honest')
    expect(setL1.gold).not.toBe('Cheater')
  })

  it('selects the side-boss winner by encounter index', () => {
    const battles: BattleEntry[] = [
      makeBattle({
        displayName: 'Main',
        damageDealt: 1_000_000,
        encounterId: 0,
        encounterIndex: 0
      }),
      makeBattle({
        displayName: 'Main',
        damageDealt: 1_000_000,
        encounterId: 0,
        encounterIndex: 0
      }),
      makeBattle({
        displayName: 'SideA',
        damageDealt: 600_000,
        encounterId: 1,
        encounterIndex: 1
      }),
      makeBattle({
        displayName: 'SideA',
        damageDealt: 600_000,
        encounterId: 1,
        encounterIndex: 1
      }),
      makeBattle({
        displayName: 'SideB',
        damageDealt: 400_000,
        encounterId: 1,
        encounterIndex: 1
      }),
      makeBattle({
        displayName: 'SideB',
        damageDealt: 400_000,
        encounterId: 1,
        encounterIndex: 1
      }),
      makeBattle({
        displayName: 'SideC',
        damageDealt: 800_000,
        encounterId: 2,
        encounterIndex: 2
      }),
      makeBattle({
        displayName: 'SideC',
        damageDealt: 800_000,
        encounterId: 2,
        encounterIndex: 2
      })
    ]

    const setL1 = calculateSetWinners(battles, new Set()).find(
      (s) => s.levelString === 'L1'
    )!

    expect(setL1.sideBoss1).toBe('SideA')
    expect(setL1.sideBoss1Value).toBe(600_000)
    expect(setL1.sideBoss2).toBe('SideC')
    expect(setL1.sideBoss2Value).toBe(800_000)
    expect(setL1.sideBoss1).not.toBe('Main')
  })

  it('requires a minimum of 2 battles to win a side boss', () => {
    const battles: BattleEntry[] = [
      makeBattle({
        displayName: 'Main',
        damageDealt: 1_000_000,
        encounterId: 0,
        encounterIndex: 0
      }),
      makeBattle({
        displayName: 'Main',
        damageDealt: 1_000_000,
        encounterId: 0,
        encounterIndex: 0
      }),
      makeBattle({
        displayName: 'OneHit',
        damageDealt: 900_000,
        encounterId: 1,
        encounterIndex: 1
      }),
      makeBattle({
        displayName: 'TwoHits',
        damageDealt: 500_000,
        encounterId: 1,
        encounterIndex: 1
      }),
      makeBattle({
        displayName: 'TwoHits',
        damageDealt: 500_000,
        encounterId: 1,
        encounterIndex: 1
      })
    ]

    const setL1 = calculateSetWinners(battles, new Set()).find(
      (s) => s.levelString === 'L1'
    )!

    expect(setL1.sideBoss1).toBe('TwoHits')
    expect(setL1.sideBoss1).not.toBe('OneHit')
  })

  it('separates Legendary (L) and Mythic (M) rarities into distinct level strings', () => {
    const battles: BattleEntry[] = [
      makeBattle({
        displayName: 'LegPlayer',
        rarity: 'Legendary',
        set: 0,
        damageDealt: 1_000_000
      }),
      makeBattle({
        displayName: 'LegPlayer',
        rarity: 'Legendary',
        set: 0,
        damageDealt: 1_000_000
      }),
      makeBattle({
        displayName: 'MythPlayer',
        rarity: 'Mythic',
        set: 0,
        damageDealt: 2_000_000
      }),
      makeBattle({
        displayName: 'MythPlayer',
        rarity: 'Mythic',
        set: 0,
        damageDealt: 2_000_000
      })
    ]

    const results = calculateSetWinners(battles, new Set())
    const l1 = results.find((s) => s.levelString === 'L1')!
    const m1 = results.find((s) => s.levelString === 'M1')!

    expect(l1.rarity).toBe('Legendary')
    expect(l1.gold).toBe('LegPlayer')
    expect(m1.rarity).toBe('Mythic')
    expect(m1.gold).toBe('MythPlayer')
  })
})

describe('calculateSetWinners -> calculatePlayerPointsFromAwards integration', () => {
  it('feeds computed set winners into the point table for a coherent total', () => {
    const battles: BattleEntry[] = [
      makeBattle({ displayName: 'Champ', damageDealt: 3_000_000 }),
      makeBattle({ displayName: 'Champ', damageDealt: 3_000_000 }),
      makeBattle({ displayName: 'Runner', damageDealt: 1_000_000 }),
      makeBattle({ displayName: 'Runner', damageDealt: 1_000_000 })
    ]

    const setWinners = calculateSetWinners(battles, new Set())
    const points = calculatePlayerPointsFromAwards(
      setWinners,
      emptySeason(),
      {}
    )

    const champ = points.find((p) => p.displayName === 'Champ')!
    expect(champ.awards.goldMedals).toBe(1)
    expect(champ.awards.mostDamageAwards).toBe(1)
    expect(champ.totalPoints).toBe(5)
    expect(points[0].displayName).toBe('Champ')
  })
})

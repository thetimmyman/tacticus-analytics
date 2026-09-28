import { describe, it, expect } from 'vitest'
import { calculateVOTLWPoints } from '@/app/components/votlw/utils/votlwCalculations'
import type {
  BattleEntry,
  TokenUsagePlayer,
  SetWinner,
  SeasonResults
} from '@tacticus/app-core/votlw.types'

const baseEntry: BattleEntry = {
  Guild: 'EOT',
  Season: '86',
  displayName: 'Alpha',
  userId: 'alpha',
  Name: 'Aethana',
  damageDealt: 1_000_000,
  damageType: 'Battle',
  remainingHp: 500_000,
  maxHp: 1_500_000,
  tier: 5,
  set: 0,
  loopIndex: 0,
  encounterId: 0,
  encounterIndex: 0,
  rarity: 'Mythic',
  startedOn: new Date('2025-11-04T10:00:00Z').toISOString(),
  completedOn: new Date('2025-11-04T10:05:00Z').toISOString()
}

const makeEntry = (overrides: Partial<BattleEntry>): BattleEntry => ({
  ...baseEntry,
  ...overrides
})

const toTokenUsage = (
  players: Array<{ name: string; tokens: number }>
): TokenUsagePlayer[] =>
  players.map(({ name, tokens }) => ({
    display_name: name,
    tokens_used: tokens,
    max_possible_tokens: 28,
    battles_fought: tokens,
    first_token_time: baseEntry.startedOn
  }))

describe('calculateVOTLWPoints', () => {
  it('tracks sweeps vs one-shots correctly', async () => {
    const battleEntries = [
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 1_200_000,
        remainingHp: 300_000
      }),
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 400_000,
        remainingHp: 0,
        maxHp: 1_500_000
      }), // sweep
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_750_000,
        remainingHp: 0,
        maxHp: 1_750_000
      }), // one-shot
      makeEntry({
        displayName: 'Charlie',
        damageDealt: 500_000,
        remainingHp: 900_000
      }),
      makeEntry({
        displayName: 'Charlie',
        damageDealt: 500_000,
        remainingHp: 800_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Alpha', tokens: 2 },
        { name: 'Bravo', tokens: 1 },
        { name: 'Charlie', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const alpha = results.playerPoints.find((p) => p.displayName === 'Alpha')!
    const bravo = results.playerPoints.find((p) => p.displayName === 'Bravo')!

    expect(alpha.sweeps).toBe(1)
    expect(alpha.oneShots).toBe(0)
    expect(alpha.tokenCount).toBe(2)
    expect(alpha.avgDamagePerHit).toBeGreaterThan(1_000_000)

    expect(bravo.sweeps).toBe(0)
    expect(bravo.oneShots).toBe(1)
    expect(bravo.avgDamagePerHit).toBe(1_750_000)
  })

  it('requires a minimum of 2 meaningful battles per boss to win a medal (Step 2 qualification)', async () => {
    const battleEntries = [
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 5_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_200_000,
        remainingHp: 300_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Alpha', tokens: 1 },
        { name: 'Bravo', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const set0 = results.setWinners.find(
      (s) => s.set === 0 && s.rarity === 'Mythic'
    )!
    expect(set0.gold).toBe('Bravo')
    expect([set0.gold, set0.silver, set0.bronze]).not.toContain('Alpha')
  })

  it('does not count a non-qualifying sweep toward the 2-battle medal gate', async () => {
    // Two tokens but one is a low sweep: one meaningful battle, so no medal.
    const battleEntries = [
      makeEntry({
        displayName: 'Cabol',
        damageDealt: 1_620_000,
        remainingHp: 300_000
      }),
      makeEntry({
        displayName: 'Cabol',
        damageDealt: 200_000,
        remainingHp: 0,
        maxHp: 1_500_000
      }), // low sweep
      makeEntry({
        displayName: 'Kodiak',
        damageDealt: 1_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Kodiak',
        damageDealt: 1_100_000,
        remainingHp: 400_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Cabol', tokens: 2 },
        { name: 'Kodiak', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const set0 = results.setWinners.find(
      (s) => s.set === 0 && s.rarity === 'Mythic'
    )!
    expect(set0.gold).toBe('Kodiak')
    expect([set0.gold, set0.silver, set0.bronze]).not.toContain('Cabol')
  })

  it('re-includes qualifying sweeps in the medal average and battle count', async () => {
    const battleEntries = [
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 1_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 1_500_000,
        remainingHp: 0,
        maxHp: 1_600_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 600_000,
        remainingHp: 900_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 700_000,
        remainingHp: 800_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Alpha', tokens: 2 },
        { name: 'Bravo', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const set0 = results.setWinners.find(
      (s) => s.set === 0 && s.rarity === 'Mythic'
    )!
    expect(set0.gold).toBe('Alpha')
    expect(set0.goldValue).toBe(1_250_000)
    expect(set0.silver).toBe('Bravo')
  })

  it('excludes crashes (0 damage) from averages and the medal gate', async () => {
    const battleEntries = [
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 2_000_000,
        remainingHp: 100_000
      }),
      makeEntry({ displayName: 'Alpha', damageDealt: 0, remainingHp: 500_000 }), // crash
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_000_000,
        remainingHp: 400_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Alpha', tokens: 2 },
        { name: 'Bravo', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const set0 = results.setWinners.find(
      (s) => s.set === 0 && s.rarity === 'Mythic'
    )!
    expect(set0.gold).toBe('Bravo')
    expect([set0.gold, set0.silver, set0.bronze]).not.toContain('Alpha')
  })

  it('includes sweep damage in the Most Damage total (matches SQL total_damage_ranked)', async () => {
    const battleEntries = [
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 1_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 1_000_000,
        remainingHp: 400_000
      }),
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 900_000,
        remainingHp: 0,
        maxHp: 5_000_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_300_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_300_000,
        remainingHp: 400_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Alpha', tokens: 3 },
        { name: 'Bravo', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const set0 = results.setWinners.find(
      (s) => s.set === 0 && s.rarity === 'Mythic'
    )!
    expect(set0.mostDamage).toBe('Alpha')
    expect(set0.mostDamageValue).toBe(2_900_000)
    expect(set0.gold).toBe('Bravo')
  })

  it('side boss: a single meaningful battle plus low sweeps does not beat a consistent 2-battle player', async () => {
    const sideEntry = (overrides: Partial<BattleEntry>) =>
      makeEntry({
        encounterId: 1,
        encounterIndex: 1,
        maxHp: 1_200_000,
        ...overrides
      })

    const battleEntries = [
      makeEntry({
        displayName: 'Filler',
        damageDealt: 500_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Filler',
        damageDealt: 500_000,
        remainingHp: 400_000
      }),
      sideEntry({
        displayName: 'TestPlayerA',
        damageDealt: 1_110_000,
        remainingHp: 90_000
      }),
      sideEntry({
        displayName: 'TestPlayerA',
        damageDealt: 300_000,
        remainingHp: 0
      }),
      sideEntry({
        displayName: 'TestPlayerA',
        damageDealt: 250_000,
        remainingHp: 0
      }),
      sideEntry({
        displayName: 'TestPlayerB',
        damageDealt: 981_000,
        remainingHp: 210_000
      }),
      sideEntry({
        displayName: 'TestPlayerB',
        damageDealt: 980_000,
        remainingHp: 220_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'TestPlayerA', tokens: 3 },
        { name: 'TestPlayerB', tokens: 2 },
        { name: 'Filler', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const set0 = results.setWinners.find(
      (s) => s.set === 0 && s.rarity === 'Mythic'
    )!
    expect(set0.sideBoss1).toBe('TestPlayerB')
    expect(set0.sideBoss1Value).toBe(980_500)
  })

  it('leaves Most Damage blank when the top-total player is not medal-qualified (SQL parity)', async () => {
    const battleEntries = [
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 10_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_100_000,
        remainingHp: 400_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Alpha', tokens: 1 },
        { name: 'Bravo', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const set0 = results.setWinners.find(
      (s) => s.set === 0 && s.rarity === 'Mythic'
    )!
    expect(set0.gold).toBe('Bravo')
    // SQL joins through qualified_avg: an unqualified rank 1 suppresses the award.
    expect(set0.mostDamage).toBe('')
    expect(set0.biggestHit).toBe('Alpha')
  })

  it('suppresses ALL set awards when nobody qualifies for a medal (SQL parity)', async () => {
    const battleEntries = [
      makeEntry({
        displayName: 'Alpha',
        damageDealt: 2_000_000,
        remainingHp: 500_000
      }),
      makeEntry({
        displayName: 'Bravo',
        damageDealt: 1_500_000,
        remainingHp: 600_000
      }),
      // SQL emits no row for a set without a main-boss qualifier.
      makeEntry({
        displayName: 'Charlie',
        encounterId: 1,
        encounterIndex: 1,
        maxHp: 1_200_000,
        damageDealt: 800_000,
        remainingHp: 200_000
      }),
      makeEntry({
        displayName: 'Charlie',
        encounterId: 1,
        encounterIndex: 1,
        maxHp: 1_200_000,
        damageDealt: 750_000,
        remainingHp: 300_000
      })
    ]

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Alpha', tokens: 1 },
        { name: 'Bravo', tokens: 1 },
        { name: 'Charlie', tokens: 2 }
      ]),
      'EOT',
      '86'
    )

    const set0 = results.setWinners.find(
      (s) => s.set === 0 && s.rarity === 'Mythic'
    )!
    expect(set0.gold).toBe('')
    expect(set0.mostDamage).toBe('')
    expect(set0.sideBoss1).toBe('')
    expect(set0.biggestHit).toBe('')
  })

  it('honors server-provided overrides for set winners and most improved', async () => {
    const battleEntries = [
      makeEntry({ displayName: 'Alpha', damageDealt: 900_000 }),
      makeEntry({ displayName: 'Bravo', damageDealt: 800_000 })
    ]

    const overrideSetWinners: SetWinner[] = [
      {
        rarity: 'Legendary',
        set: 0,
        levelString: 'L1',
        bossName: 'Belisarius Cawl',
        gold: 'Alpha',
        goldValue: 1_234_567,
        silver: 'Bravo',
        silverValue: 1_111_111,
        bronze: '',
        mostDamage: 'Alpha',
        sideBoss1: '',
        sideBoss2: '',
        biggestHit: '',
        bronzeValue: undefined,
        mostDamageValue: undefined,
        sideBoss1Value: undefined,
        sideBoss2Value: undefined,
        biggestHitValue: undefined
      }
    ]

    const overrideMostImproved: SeasonResults['mostImproved'] = {
      player: 'Alpha',
      improvementPct: 150.25
    }

    const results = await calculateVOTLWPoints(
      battleEntries,
      [],
      new Set(),
      toTokenUsage([
        { name: 'Alpha', tokens: 1 },
        { name: 'Bravo', tokens: 1 }
      ]),
      'EOT',
      '86',
      null,
      {
        setWinnersOverride: overrideSetWinners,
        mostImprovedOverride: overrideMostImproved
      }
    )

    expect(results.setWinners).toEqual(overrideSetWinners)
    expect(results.seasonAwards.mostImproved).toEqual(overrideMostImproved)
  })
})

import { describe, expect, it } from 'vitest'
import {
  computeBossPlayerAggregates,
  stableBossPlayerId,
  type BossStatsRow
} from '@/app/(dashboard)/leaderboards/lib/boss-player-aggregates'

const row = (overrides: Partial<BossStatsRow>): BossStatsRow => ({
  displayName: 'Alice',
  userId: 'u-alice',
  Guild: 'G1',
  damageDealt: 100,
  remainingHp: 500,
  maxHp: 1000,
  ...overrides
})

describe('stableBossPlayerId', () => {
  it('prefers userId, falls back to Guild|displayName', () => {
    expect(
      stableBossPlayerId({ userId: 'u1', Guild: 'G', displayName: 'A' })
    ).toBe('u1')
    expect(
      stableBossPlayerId({ userId: null, Guild: 'G', displayName: 'A' })
    ).toBe('G|A')
  })
})

describe('computeBossPlayerAggregates', () => {
  it('averages non-kill battles per player and tracks raw max', () => {
    const aggregates = computeBossPlayerAggregates([
      row({ damageDealt: 100 }),
      row({ damageDealt: 300 }),
      row({
        displayName: 'Bob',
        userId: 'u-bob',
        damageDealt: 50
      })
    ])

    const alice = aggregates.get('u-alice')
    expect(alice).toBeDefined()
    expect(alice?.avgDamage).toBe(200)
    expect(alice?.battleCount).toBe(2)
    expect(alice?.maxDamage).toBe(300)
    expect(aggregates.get('u-bob')?.avgDamage).toBe(50)
  })

  it('keeps one-shots (remainingHp 0, damage >= maxHp) in the average', () => {
    const aggregates = computeBossPlayerAggregates([
      row({ damageDealt: 100 }),
      row({ damageDealt: 1200, remainingHp: 0, maxHp: 1000 })
    ])

    const alice = aggregates.get('u-alice')
    expect(alice?.avgDamage).toBe(650)
    expect(alice?.battleCount).toBe(2)
  })

  it('excludes sub-average sweeps from the average but not from max', () => {
    const aggregates = computeBossPlayerAggregates([
      row({ damageDealt: 400 }),
      row({ displayName: 'Bob', userId: 'u-bob', damageDealt: 200 }),
      row({ damageDealt: 350, remainingHp: 0, maxHp: 1000 })
    ])

    const alice = aggregates.get('u-alice')
    expect(alice?.avgDamage).toBe(400)
    expect(alice?.battleCount).toBe(1)
    expect(alice?.maxDamage).toBe(400)

    const sweepMax = computeBossPlayerAggregates([
      row({ damageDealt: 400 }),
      row({ damageDealt: 450, remainingHp: 0, maxHp: 1000 })
    ])
    expect(sweepMax.get('u-alice')?.maxDamage).toBe(450)
  })

  it('re-includes qualifying sweeps that clear GREATEST(player avg, reference avg)', () => {
    const aggregates = computeBossPlayerAggregates([
      row({ damageDealt: 400 }),
      row({ displayName: 'Bob', userId: 'u-bob', damageDealt: 200 }),
      row({ damageDealt: 500, remainingHp: 0, maxHp: 1000 })
    ])

    const alice = aggregates.get('u-alice')
    expect(alice?.avgDamage).toBe(450)
    expect(alice?.battleCount).toBe(2)
  })

  it('does not include an above-reference sweep that is below the player own avg', () => {
    const aggregates = computeBossPlayerAggregates([
      row({ damageDealt: 600 }),
      row({ displayName: 'Bob', userId: 'u-bob', damageDealt: 100 }),
      row({ displayName: 'Bob', userId: 'u-bob', damageDealt: 100 }),
      // Sweep at 400: above reference, below Alice's own avg → excluded.
      row({ damageDealt: 400, remainingHp: 0, maxHp: 1000 })
    ])

    const alice = aggregates.get('u-alice')
    expect(alice?.avgDamage).toBe(600)
    expect(alice?.battleCount).toBe(1)
  })

  it('ignores crash rows (damageDealt 0) entirely', () => {
    const aggregates = computeBossPlayerAggregates([
      row({ damageDealt: 0 }),
      row({ damageDealt: 100 })
    ])

    const alice = aggregates.get('u-alice')
    expect(alice?.avgDamage).toBe(100)
    expect(alice?.battleCount).toBe(1)
  })

  it('treats rows with null maxHp and remainingHp 0 as non-sweeps (legacy rows)', () => {
    const aggregates = computeBossPlayerAggregates([
      row({ damageDealt: 100, remainingHp: 0, maxHp: null })
    ])

    const alice = aggregates.get('u-alice')
    expect(alice?.avgDamage).toBe(100)
    expect(alice?.battleCount).toBe(1)
  })

  it('gives an only-ever-swept player a zero-count aggregate when nothing qualifies', () => {
    const aggregates = computeBossPlayerAggregates([
      row({ displayName: 'Bob', userId: 'u-bob', damageDealt: 500 }),
      row({ damageDealt: 100, remainingHp: 0, maxHp: 1000 })
    ])

    const alice = aggregates.get('u-alice')
    expect(alice?.avgDamage).toBe(0)
    expect(alice?.battleCount).toBe(0)
    expect(alice?.maxDamage).toBe(100)
  })
})

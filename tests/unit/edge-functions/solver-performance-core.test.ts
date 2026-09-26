import { describe, it, expect } from 'vitest'
import {
  aggregatePerformanceRows,
  type PerformanceRow
} from '../../../supabase/functions/boss-assignment-solver/performance-core.ts'

const BOSS = 'szarekh|Legendary|4|0'

const rowFor = (
  displayName: string,
  damageDealt: number,
  opts: { remainingHp?: number; maxHp?: number; bossKey?: string } = {}
): PerformanceRow => ({
  bossKey: opts.bossKey ?? BOSS,
  displayName,
  damageDealt,
  remainingHp: opts.remainingHp ?? 500_000,
  maxHp: opts.maxHp ?? 30_000_000
})

const sweepFor = (
  displayName: string,
  damageDealt: number,
  bossKey = BOSS
): PerformanceRow => ({
  bossKey,
  displayName,
  damageDealt,
  remainingHp: 0,
  maxHp: 30_000_000
})

describe('solver performance-core aggregation', () => {
  it('excludes sweeps from the boss reference baseline', () => {
    const { bossAvg } = aggregatePerformanceRows([
      rowFor('Alpha', 1_000_000),
      rowFor('Bravo', 2_000_000),
      sweepFor('Charlie', 100_000) // must not drag the baseline down
    ])
    expect(bossAvg.get(BOSS)).toBe(1_500_000)
  })

  it('keeps one-shots in baseline and player averages', () => {
    const { bossAvg, playerAvg } = aggregatePerformanceRows([
      rowFor('Alpha', 1_000_000),
      rowFor('Bravo', 3_000_000, { remainingHp: 0, maxHp: 3_000_000 })
    ])
    expect(bossAvg.get(BOSS)).toBe(2_000_000)
    expect(playerAvg.get('Bravo')?.get(BOSS)).toBe(3_000_000)
  })

  it('folds qualifying sweeps into the player average (WI-1462 gate)', () => {
    const { playerAvg } = aggregatePerformanceRows([
      rowFor('Alpha', 1_000_000),
      sweepFor('Alpha', 1_500_000)
    ])
    expect(playerAvg.get('Alpha')?.get(BOSS)).toBe(1_250_000)
  })

  it('drops non-qualifying sweeps from the player average', () => {
    const { playerAvg } = aggregatePerformanceRows([
      rowFor('Alpha', 1_000_000),
      sweepFor('Alpha', 400_000) // below both gates
    ])
    expect(playerAvg.get('Alpha')?.get(BOSS)).toBe(1_000_000)
  })

  it('emits no average for a sweeps-only player instead of a deflated one', () => {
    const { playerAvg, battlesByPlayer } = aggregatePerformanceRows([
      rowFor('Alpha', 1_000_000),
      sweepFor('Charlie', 100_000),
      sweepFor('Charlie', 200_000)
    ])
    expect(playerAvg.get('Charlie')?.has(BOSS)).toBe(false)
    // Sweeps stay out of the average, but their activity still counts.
    expect(battlesByPlayer.get('Charlie')).toBe(2)
  })

  it('keys averages per boss independently', () => {
    const otherBoss = 'magnus|Mythic|0|0'
    const { playerAvg } = aggregatePerformanceRows([
      rowFor('Alpha', 1_000_000),
      rowFor('Alpha', 4_000_000, { bossKey: otherBoss })
    ])
    expect(playerAvg.get('Alpha')?.get(BOSS)).toBe(1_000_000)
    expect(playerAvg.get('Alpha')?.get(otherBoss)).toBe(4_000_000)
  })
})

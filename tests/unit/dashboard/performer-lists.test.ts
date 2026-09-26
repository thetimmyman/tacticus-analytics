import { describe, it, expect } from 'vitest'
import { buildTopBottomPerformers } from '@/app/lib/dashboard/performer-lists'

const roster = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `P${i + 1}`,
    vsGuildPct: 100 - i // already sorted DESC
  }))

describe('buildTopBottomPerformers', () => {
  it('REGRESSION: a 3-player guild gets an EMPTY bottom list (never #-1/#0 ranks)', () => {
    const { topPerformers, bottomPerformers } = buildTopBottomPerformers(
      roster(3)
    )
    // slice(-5) of 3 players would yield ranks -1, 0, 1.
    expect(bottomPerformers).toEqual([])
    expect(topPerformers.map((p) => p.rank)).toEqual([1, 2, 3])
  })

  it('REGRESSION: every emitted bottom rank is >= 1 for guilds of size 1..5', () => {
    for (let n = 1; n <= 5; n++) {
      const { bottomPerformers } = buildTopBottomPerformers(roster(n))
      expect(bottomPerformers).toEqual([])
    }
  })

  it('exactly 5 players: bottom list is empty (no list distinct from top yet)', () => {
    const { topPerformers, bottomPerformers } = buildTopBottomPerformers(
      roster(5)
    )
    expect(topPerformers).toHaveLength(5)
    expect(bottomPerformers).toEqual([])
  })

  it('6 players: bottom list appears with the correct 1-based ranks (2..6)', () => {
    const { topPerformers, bottomPerformers } = buildTopBottomPerformers(
      roster(6)
    )
    expect(topPerformers.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5])
    expect(bottomPerformers.map((p) => p.rank)).toEqual([2, 3, 4, 5, 6])
    expect(bottomPerformers.map((p) => p.name)).toEqual([
      'P2',
      'P3',
      'P4',
      'P5',
      'P6'
    ])
  })

  it('large guild (12): top = ranks 1..5, bottom = ranks 8..12, no overlap', () => {
    const { topPerformers, bottomPerformers } = buildTopBottomPerformers(
      roster(12)
    )
    expect(topPerformers.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5])
    expect(bottomPerformers.map((p) => p.rank)).toEqual([8, 9, 10, 11, 12])
    const topNames = new Set(topPerformers.map((p) => p.name))
    expect(bottomPerformers.some((p) => topNames.has(p.name))).toBe(false)
  })

  it('empty roster: both lists empty', () => {
    const { topPerformers, bottomPerformers } = buildTopBottomPerformers([])
    expect(topPerformers).toEqual([])
    expect(bottomPerformers).toEqual([])
  })
})

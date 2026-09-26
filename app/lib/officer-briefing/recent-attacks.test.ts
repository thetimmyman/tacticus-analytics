// Points are chronological, as loadRecentAttacks returns them.

import { describe, it, expect } from 'vitest'
import { computeStrongStreak } from './recent-attacks'
import { raritySetToColumns } from '@/app/lib/catalogs/rarity-set'
import type { RecentAttackPoint } from './types'

describe('raritySetToColumns (inverse of SQL get_rarity_set)', () => {
  it('maps Legendary tiers to set = tier − 1', () => {
    expect(raritySetToColumns('L1')).toEqual({ rarity: 'Legendary', set: 0 })
    expect(raritySetToColumns('L4')).toEqual({ rarity: 'Legendary', set: 3 })
  })
  it('maps Mythic tiers to set = tier − 1', () => {
    expect(raritySetToColumns('M1')).toEqual({ rarity: 'Mythic', set: 0 })
    expect(raritySetToColumns('M5')).toEqual({ rarity: 'Mythic', set: 4 })
  })
  it('returns null outside the closed enumeration', () => {
    expect(raritySetToColumns(null)).toBeNull()
    expect(raritySetToColumns('')).toBeNull()
    expect(raritySetToColumns('Legendary')).toBeNull()
    expect(raritySetToColumns('L6')).toBeNull()
    expect(raritySetToColumns('X1')).toBeNull()
  })
})

const pt = (damage: number, expected: number | null): RecentAttackPoint => ({
  startedAt: '2026-07-08T00:00:00Z',
  damage,
  expected,
  bossName: 'Magnus'
})

describe('computeStrongStreak', () => {
  it('null on no attacks', () => {
    expect(computeStrongStreak([])).toBeNull()
  })

  it('counts consecutive most-recent attacks at/above expectation', () => {
    expect(
      computeStrongStreak([
        pt(50, 100),
        pt(120, 100),
        pt(100, 100),
        pt(130, 100)
      ])
    ).toBe(3)
  })

  it('0 when the latest attack fell short', () => {
    expect(computeStrongStreak([pt(150, 100), pt(80, 100)])).toBe(0)
  })

  it('an older weak attack breaks the streak', () => {
    expect(computeStrongStreak([pt(120, 100), pt(80, 100), pt(120, 100)])).toBe(
      1
    )
  })

  it('null when there is no expectation to judge against', () => {
    expect(computeStrongStreak([pt(120, null), pt(130, null)])).toBeNull()
  })

  it('stops at a null expectation but keeps an already-counted streak', () => {
    expect(
      computeStrongStreak([pt(120, null), pt(130, 100), pt(140, 100)])
    ).toBe(2)
  })
})

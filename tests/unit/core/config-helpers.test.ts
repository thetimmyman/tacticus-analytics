import { describe, it, expect } from 'vitest'
import {
  RARITY_RANK,
  rarityRank,
  isMainBossEncounter,
  isPrimeEncounter
} from '@/app/lib/config'

describe('config rarity/encounter helpers (WI-2212)', () => {
  it('RARITY_RANK is strictly descending so all six rarities tie-break', () => {
    const order = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common']
    const ranks = order.map((r) => RARITY_RANK[r])
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeLessThan(ranks[i - 1]!)
    }
  })

  it('rarityRank tolerates unknown/null (sorts below Common)', () => {
    expect(rarityRank('Mythic')).toBeGreaterThan(rarityRank('Common'))
    expect(rarityRank('Common')).toBeGreaterThan(rarityRank(null))
    expect(rarityRank('not-a-rarity')).toBe(0)
    expect(rarityRank(undefined)).toBe(0)
  })

  it('main vs prime classification are complements', () => {
    expect(isMainBossEncounter(0)).toBe(true)
    expect(isPrimeEncounter(0)).toBe(false)
    expect(isMainBossEncounter(1)).toBe(false)
    expect(isPrimeEncounter(1)).toBe(true)
    expect(isPrimeEncounter(2)).toBe(true)
  })
})

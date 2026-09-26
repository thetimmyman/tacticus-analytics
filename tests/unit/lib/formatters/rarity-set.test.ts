import { describe, expect, it } from 'vitest'
import {
  RARITY_SET_LEGENDARY_OPTIONS,
  RARITY_SET_LEGENDARY_VALUES,
  RARITY_SET_MYTHIC_OPTIONS,
  RARITY_SET_MYTHIC_VALUES,
  RARITY_SET_VALUES,
  compareRaritySetsHighToLow,
  isValidRaritySet,
  raritySetLabel,
  tierKeycap
} from '@/app/lib/catalogs/rarity-set'

describe('rarity-set formatter', () => {
  describe('RARITY_SET_VALUES', () => {
    it('is the concatenation of legendary + mythic', () => {
      expect(RARITY_SET_VALUES).toEqual([
        ...RARITY_SET_LEGENDARY_VALUES,
        ...RARITY_SET_MYTHIC_VALUES
      ])
    })

    it('covers the canonical 10 tiers (L1-L5 + M1-M5)', () => {
      expect(RARITY_SET_VALUES).toEqual([
        'L1',
        'L2',
        'L3',
        'L4',
        'L5',
        'M1',
        'M2',
        'M3',
        'M4',
        'M5'
      ])
    })
  })

  describe('isValidRaritySet', () => {
    it.each(RARITY_SET_VALUES)('accepts canonical value %s', (value) => {
      expect(isValidRaritySet(value)).toBe(true)
    })

    it.each([
      'L0',
      'L6',
      'M0',
      'M6',
      '',
      'legendary',
      'l1',
      null,
      undefined,
      1,
      {}
    ])('rejects non-canonical %p', (value) => {
      expect(isValidRaritySet(value)).toBe(false)
    })
  })

  describe('raritySetLabel', () => {
    it('renders Legendary labels', () => {
      expect(raritySetLabel('L1')).toBe('L1 (Legendary Set 1)')
      expect(raritySetLabel('L5')).toBe('L5 (Legendary Set 5)')
    })

    it('renders Mythic labels', () => {
      expect(raritySetLabel('M1')).toBe('M1 (Mythic Set 1)')
      expect(raritySetLabel('M3')).toBe('M3 (Mythic Set 3)')
    })

    it('returns the input unchanged for invalid values', () => {
      expect(raritySetLabel('X1')).toBe('X1')
      expect(raritySetLabel('')).toBe('')
    })
  })

  it('sorts canonical rarity output M5→M1 then L5→L1', () => {
    expect([...RARITY_SET_VALUES].sort(compareRaritySetsHighToLow)).toEqual([
      'M5',
      'M4',
      'M3',
      'M2',
      'M1',
      'L5',
      'L4',
      'L3',
      'L2',
      'L1'
    ])
  })

  describe('RARITY_SET_*_OPTIONS', () => {
    it('pairs each value with its display label', () => {
      expect(RARITY_SET_LEGENDARY_OPTIONS[0]).toEqual({
        value: 'L1',
        label: 'L1 (Legendary Set 1)'
      })
      expect(RARITY_SET_MYTHIC_OPTIONS[2]).toEqual({
        value: 'M3',
        label: 'M3 (Mythic Set 3)'
      })
    })
  })

  describe('tierKeycap', () => {
    it('returns empty string for null', () => {
      expect(tierKeycap(null)).toBe('')
    })

    it('returns keycap emoji for 1-10', () => {
      expect(tierKeycap(1)).toBe('1⃣')
      expect(tierKeycap(10)).toBe('🔟')
    })

    it('falls back to T<n> for out-of-range tiers', () => {
      expect(tierKeycap(11)).toBe('T11')
      expect(tierKeycap(0)).toBe('T0')
    })
  })
})

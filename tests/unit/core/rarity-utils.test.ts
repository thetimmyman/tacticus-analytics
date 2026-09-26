import { describe, it, expect } from 'vitest'
import {
  RARITY_HIERARCHY,
  RARITY_CONFIGS,
  normalizeRarity,
  getTopRaritiesWithData,
  getAllRaritiesWithData,
  getRarityConfig,
  getRarityPrefix,
  getRarityDisplayName,
  sortRaritiesByHierarchy,
  type Rarity,
  type BossHit
} from '@tacticus/app-core/rarity-utils'

describe('Rarity Utilities', () => {
  describe('RARITY_HIERARCHY', () => {
    it('has correct order from highest to lowest', () => {
      expect(RARITY_HIERARCHY).toEqual([
        'Mythic',
        'Legendary',
        'Epic',
        'Rare',
        'Uncommon',
        'Common'
      ])
    })

    it('has 6 rarities', () => {
      expect(RARITY_HIERARCHY).toHaveLength(6)
    })
  })

  describe('RARITY_CONFIGS', () => {
    it('has config for all rarities', () => {
      for (const rarity of RARITY_HIERARCHY) {
        expect(RARITY_CONFIGS[rarity]).toBeDefined()
      }
    })

    it('has correct prefixes', () => {
      expect(RARITY_CONFIGS.Mythic.prefix).toBe('M')
      expect(RARITY_CONFIGS.Legendary.prefix).toBe('L')
      expect(RARITY_CONFIGS.Epic.prefix).toBe('E')
      expect(RARITY_CONFIGS.Rare.prefix).toBe('R')
      expect(RARITY_CONFIGS.Uncommon.prefix).toBe('U')
      expect(RARITY_CONFIGS.Common.prefix).toBe('C')
    })

    it('has colors defined', () => {
      for (const rarity of RARITY_HIERARCHY) {
        expect(RARITY_CONFIGS[rarity].color).toBeDefined()
        expect(RARITY_CONFIGS[rarity].color).toMatch(/^#[0-9a-f]{6}$/i)
      }
    })

    it('has cssClass defined for all', () => {
      for (const rarity of RARITY_HIERARCHY) {
        expect(RARITY_CONFIGS[rarity].cssClass).toBeDefined()
        expect(typeof RARITY_CONFIGS[rarity].cssClass).toBe('string')
      }
    })
  })

  describe('normalizeRarity', () => {
    it('returns null for non-string values', () => {
      expect(normalizeRarity(null)).toBeNull()
      expect(normalizeRarity(undefined)).toBeNull()
      expect(normalizeRarity(123)).toBeNull()
      expect(normalizeRarity({})).toBeNull()
    })

    it('normalizes exact matches', () => {
      expect(normalizeRarity('Mythic')).toBe('Mythic')
      expect(normalizeRarity('Legendary')).toBe('Legendary')
      expect(normalizeRarity('Common')).toBe('Common')
    })

    it('normalizes case-insensitively', () => {
      expect(normalizeRarity('mythic')).toBe('Mythic')
      expect(normalizeRarity('LEGENDARY')).toBe('Legendary')
      expect(normalizeRarity('epic')).toBe('Epic')
      expect(normalizeRarity('RARE')).toBe('Rare')
    })

    it('trims whitespace', () => {
      expect(normalizeRarity('  Mythic  ')).toBe('Mythic')
      expect(normalizeRarity('\tLegendary\n')).toBe('Legendary')
    })

    it('returns null for unknown values', () => {
      expect(normalizeRarity('SuperRare')).toBeNull()
      expect(normalizeRarity('Unknown')).toBeNull()
      expect(normalizeRarity('')).toBeNull()
    })
  })

  describe('getTopRaritiesWithData', () => {
    it('returns empty array for empty input', () => {
      expect(getTopRaritiesWithData([])).toEqual([])
    })

    it('returns empty array for null/undefined', () => {
      expect(getTopRaritiesWithData(null as unknown as BossHit[])).toEqual([])
      expect(getTopRaritiesWithData(undefined as unknown as BossHit[])).toEqual(
        []
      )
    })

    it('returns top 2 rarities by default', () => {
      const bossHits: BossHit[] = [
        { rarity: 'Legendary', damage: 100 },
        { rarity: 'Epic', damage: 100 },
        { rarity: 'Rare', damage: 100 }
      ]
      expect(getTopRaritiesWithData(bossHits)).toEqual(['Legendary', 'Epic'])
    })

    it('respects topN parameter', () => {
      const bossHits: BossHit[] = [
        { rarity: 'Legendary', damage: 100 },
        { rarity: 'Epic', damage: 100 },
        { rarity: 'Rare', damage: 100 }
      ]
      expect(getTopRaritiesWithData(bossHits, 1)).toEqual(['Legendary'])
      expect(getTopRaritiesWithData(bossHits, 3)).toEqual([
        'Legendary',
        'Epic',
        'Rare'
      ])
    })

    it('orders by hierarchy, not by input order', () => {
      const bossHits: BossHit[] = [
        { rarity: 'Common', damage: 100 },
        { rarity: 'Mythic', damage: 100 },
        { rarity: 'Rare', damage: 100 }
      ]
      expect(getTopRaritiesWithData(bossHits, 3)).toEqual([
        'Mythic',
        'Rare',
        'Common'
      ])
    })

    it('filters out zero damage hits', () => {
      const bossHits: BossHit[] = [
        { rarity: 'Mythic', damage: 0 },
        { rarity: 'Legendary', damage: 100 }
      ]
      expect(getTopRaritiesWithData(bossHits)).toEqual(['Legendary'])
    })

    it('handles duplicates', () => {
      const bossHits: BossHit[] = [
        { rarity: 'Legendary', damage: 100 },
        { rarity: 'Legendary', damage: 200 },
        { rarity: 'Epic', damage: 100 }
      ]
      expect(getTopRaritiesWithData(bossHits)).toEqual(['Legendary', 'Epic'])
    })
  })

  describe('getAllRaritiesWithData', () => {
    it('returns all rarities that have data', () => {
      const bossHits: BossHit[] = [
        { rarity: 'Legendary', damage: 100 },
        { rarity: 'Epic', damage: 100 },
        { rarity: 'Rare', damage: 100 },
        { rarity: 'Common', damage: 100 }
      ]
      expect(getAllRaritiesWithData(bossHits)).toEqual([
        'Legendary',
        'Epic',
        'Rare',
        'Common'
      ])
    })
  })

  describe('getRarityConfig', () => {
    it('returns config for valid rarity', () => {
      const config = getRarityConfig('Mythic')
      expect(config.prefix).toBe('M')
      expect(config.color).toBe('#ff6b35')
    })

    it('returns Common config for unknown rarity', () => {
      const config = getRarityConfig('Unknown')
      expect(config).toEqual(RARITY_CONFIGS.Common)
    })
  })

  describe('getRarityPrefix', () => {
    it('returns correct prefix for known rarities', () => {
      expect(getRarityPrefix('Mythic')).toBe('M')
      expect(getRarityPrefix('Legendary')).toBe('L')
      expect(getRarityPrefix('Epic')).toBe('E')
    })

    it('handles case-insensitive input', () => {
      expect(getRarityPrefix('mythic')).toBe('M')
      expect(getRarityPrefix('LEGENDARY')).toBe('L')
    })

    it('returns empty string for unknown rarity', () => {
      expect(getRarityPrefix('Unknown')).toBe('')
    })
  })

  describe('getRarityDisplayName', () => {
    it('returns normalized rarity name', () => {
      expect(getRarityDisplayName('mythic')).toBe('Mythic')
      expect(getRarityDisplayName('LEGENDARY')).toBe('Legendary')
    })

    it('returns original for unknown rarity', () => {
      expect(getRarityDisplayName('Unknown')).toBe('Unknown')
    })
  })

  describe('sortRaritiesByHierarchy', () => {
    it('sorts string array by hierarchy (ascending)', () => {
      const items: Rarity[] = ['Common', 'Mythic', 'Epic']
      expect(sortRaritiesByHierarchy(items)).toEqual([
        'Mythic',
        'Epic',
        'Common'
      ])
    })

    it('sorts string array by hierarchy (descending)', () => {
      const items: Rarity[] = ['Common', 'Mythic', 'Epic']
      expect(sortRaritiesByHierarchy(items, 'desc')).toEqual([
        'Common',
        'Epic',
        'Mythic'
      ])
    })

    it('sorts object array by rarity property', () => {
      const items = [
        { rarity: 'Common', damage: 100 },
        { rarity: 'Mythic', damage: 200 },
        { rarity: 'Epic', damage: 150 }
      ]
      const sorted = sortRaritiesByHierarchy(items)
      expect(sorted[0].rarity).toBe('Mythic')
      expect(sorted[1].rarity).toBe('Epic')
      expect(sorted[2].rarity).toBe('Common')
    })

    it('does not mutate original array', () => {
      const items: Rarity[] = ['Common', 'Mythic']
      const sorted = sortRaritiesByHierarchy(items)
      expect(items).toEqual(['Common', 'Mythic'])
      expect(sorted).not.toBe(items)
    })

    it('handles empty array', () => {
      expect(sortRaritiesByHierarchy([])).toEqual([])
    })

    it('handles single item', () => {
      expect(sortRaritiesByHierarchy(['Mythic'])).toEqual(['Mythic'])
    })
  })
})

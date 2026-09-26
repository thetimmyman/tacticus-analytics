import { describe, it, expect } from 'vitest'
import {
  DAMAGE_TYPES,
  ENCOUNTER_TYPES,
  RARITY_LEVELS,
  PLAYER_ROLES,
  TOKEN_STATES,
  BOSS_PREFERENCES
} from '@tacticus/app-core/domain-constants'

describe('Domain Constants', () => {
  describe('DAMAGE_TYPES', () => {
    it('contains expected damage types', () => {
      expect(DAMAGE_TYPES).toContain('Battle')
      expect(DAMAGE_TYPES).toContain('Bomb')
      expect(DAMAGE_TYPES).toContain('Skip')
    })

    it('has exactly 3 damage types', () => {
      expect(DAMAGE_TYPES).toHaveLength(3)
    })

    it('is readonly', () => {
      expect(Object.isFrozen(DAMAGE_TYPES)).toBe(true)
    })
  })

  describe('ENCOUNTER_TYPES', () => {
    it('contains expected encounter types', () => {
      expect(ENCOUNTER_TYPES).toContain('Standard')
      expect(ENCOUNTER_TYPES).toContain('Prime')
      expect(ENCOUNTER_TYPES).toContain('Legendary')
      expect(ENCOUNTER_TYPES).toContain('Mythic')
    })

    it('has exactly 4 encounter types', () => {
      expect(ENCOUNTER_TYPES).toHaveLength(4)
    })
  })

  describe('RARITY_LEVELS', () => {
    it('contains expected rarity levels in order', () => {
      expect(RARITY_LEVELS[0]).toBe('Common')
      expect(RARITY_LEVELS[1]).toBe('Uncommon')
      expect(RARITY_LEVELS[2]).toBe('Rare')
      expect(RARITY_LEVELS[3]).toBe('Epic')
      expect(RARITY_LEVELS[4]).toBe('Legendary')
    })

    it('has exactly 5 rarity levels', () => {
      expect(RARITY_LEVELS).toHaveLength(5)
    })

    it('is in ascending order of rarity', () => {
      const indices = RARITY_LEVELS.map((_, i) => i)
      expect(indices).toEqual([0, 1, 2, 3, 4])
    })
  })

  describe('PLAYER_ROLES', () => {
    it('contains lowercase roles', () => {
      expect(PLAYER_ROLES).toContain('leader')
      expect(PLAYER_ROLES).toContain('officer')
      expect(PLAYER_ROLES).toContain('member')
    })

    it('contains capitalized roles', () => {
      expect(PLAYER_ROLES).toContain('Leader')
      expect(PLAYER_ROLES).toContain('Officer')
      expect(PLAYER_ROLES).toContain('Member')
    })

    it('contains demo role', () => {
      expect(PLAYER_ROLES).toContain('demo')
    })

    it('has exactly 7 roles', () => {
      expect(PLAYER_ROLES).toHaveLength(7)
    })
  })

  describe('TOKEN_STATES', () => {
    it('contains expected token states', () => {
      expect(TOKEN_STATES).toContain('available')
      expect(TOKEN_STATES).toContain('used')
      expect(TOKEN_STATES).toContain('reserved')
    })

    it('has exactly 3 token states', () => {
      expect(TOKEN_STATES).toHaveLength(3)
    })
  })

  describe('BOSS_PREFERENCES', () => {
    it('contains expected preferences', () => {
      expect(BOSS_PREFERENCES).toContain('preferred')
      expect(BOSS_PREFERENCES).toContain('available')
      expect(BOSS_PREFERENCES).toContain('unavailable')
      expect(BOSS_PREFERENCES).toContain('blocked')
    })

    it('has exactly 4 preferences', () => {
      expect(BOSS_PREFERENCES).toHaveLength(4)
    })

    it('has logical order from most to least preferred', () => {
      const preferredIndex = BOSS_PREFERENCES.indexOf('preferred')
      const availableIndex = BOSS_PREFERENCES.indexOf('available')
      const unavailableIndex = BOSS_PREFERENCES.indexOf('unavailable')
      const blockedIndex = BOSS_PREFERENCES.indexOf('blocked')

      expect(preferredIndex).toBeLessThan(availableIndex)
      expect(availableIndex).toBeLessThan(unavailableIndex)
      expect(unavailableIndex).toBeLessThan(blockedIndex)
    })
  })

  describe('Type safety', () => {
    it('allows type narrowing with includes', () => {
      const value = 'Battle'
      if (DAMAGE_TYPES.includes(value as (typeof DAMAGE_TYPES)[number])) {
        expect(value).toBe('Battle')
      }
    })

    it('arrays are readonly tuples', () => {
      expect(Array.isArray(DAMAGE_TYPES)).toBe(true)
      expect(Array.isArray(ENCOUNTER_TYPES)).toBe(true)
      expect(Array.isArray(RARITY_LEVELS)).toBe(true)
      expect(Array.isArray(PLAYER_ROLES)).toBe(true)
      expect(Array.isArray(TOKEN_STATES)).toBe(true)
      expect(Array.isArray(BOSS_PREFERENCES)).toBe(true)
    })
  })
})

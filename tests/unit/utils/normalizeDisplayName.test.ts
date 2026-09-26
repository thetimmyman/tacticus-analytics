import { describe, it, expect } from 'vitest'
import { normalizeDisplayName } from '@/app/lib/utils/normalize'

describe('normalizeDisplayName', () => {
  describe('basic normalization', () => {
    it('converts to lowercase', () => {
      expect(normalizeDisplayName('TestPlayer')).toBe('testplayer')
      expect(normalizeDisplayName('ALLCAPS')).toBe('allcaps')
      expect(normalizeDisplayName('MixedCase')).toBe('mixedcase')
    })

    it('trims whitespace', () => {
      expect(normalizeDisplayName('  player  ')).toBe('player')
      expect(normalizeDisplayName('\tname\n')).toBe('name')
      expect(normalizeDisplayName('  ')).toBe('')
    })

    it('handles combined operations', () => {
      expect(normalizeDisplayName('  TestPlayer  ')).toBe('testplayer')
      expect(normalizeDisplayName(' MIXED Case ')).toBe('mixed case')
    })
  })

  describe('edge cases', () => {
    it('returns empty string for null', () => {
      expect(normalizeDisplayName(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(normalizeDisplayName(undefined)).toBe('')
    })

    it('returns empty string for empty string', () => {
      expect(normalizeDisplayName('')).toBe('')
    })

    it('returns empty string for whitespace-only input', () => {
      expect(normalizeDisplayName('   ')).toBe('')
      expect(normalizeDisplayName('\t\n')).toBe('')
    })
  })

  describe('special characters', () => {
    it('preserves numbers', () => {
      expect(normalizeDisplayName('Player123')).toBe('player123')
      expect(normalizeDisplayName('123Player')).toBe('123player')
    })

    it('preserves special characters', () => {
      expect(normalizeDisplayName('Player_Name')).toBe('player_name')
      expect(normalizeDisplayName('Player-Name')).toBe('player-name')
      expect(normalizeDisplayName('Player.Name')).toBe('player.name')
    })

    it('preserves spaces within name', () => {
      expect(normalizeDisplayName('Player Name')).toBe('player name')
      expect(normalizeDisplayName('Multiple Word Name')).toBe(
        'multiple word name'
      )
    })

    it('handles unicode characters', () => {
      expect(normalizeDisplayName('Plàyér')).toBe('plàyér')
      expect(normalizeDisplayName('中文名')).toBe('中文名')
    })

    it('handles emoji', () => {
      expect(normalizeDisplayName('Player🎮')).toBe('player🎮')
    })
  })

  describe('comparison use cases', () => {
    it('normalizes for case-insensitive comparison', () => {
      const name1 = normalizeDisplayName('TestPlayer')
      const name2 = normalizeDisplayName('testplayer')
      const name3 = normalizeDisplayName('TESTPLAYER')

      expect(name1).toBe(name2)
      expect(name2).toBe(name3)
    })

    it('normalizes for whitespace-insensitive comparison', () => {
      const name1 = normalizeDisplayName('Player')
      const name2 = normalizeDisplayName('  Player  ')
      const name3 = normalizeDisplayName('Player ')

      expect(name1).toBe(name2)
      expect(name2).toBe(name3)
    })
  })
})

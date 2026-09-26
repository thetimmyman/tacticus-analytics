import { describe, it, expect } from 'vitest'
import {
  calculateDamagePercentage,
  formatDamagePercentage,
  getDamagePercentageColor
} from '@/app/lib/utils/damage-comparison'

describe('Damage Comparison Utilities', () => {
  describe('calculateDamagePercentage', () => {
    it('returns null when avgDamage is null', () => {
      expect(calculateDamagePercentage(100000, null)).toBeNull()
    })

    it('returns null when avgDamage is undefined', () => {
      expect(calculateDamagePercentage(100000, undefined)).toBeNull()
    })

    it('returns null when avgDamage is zero', () => {
      expect(calculateDamagePercentage(100000, 0)).toBeNull()
    })

    it('returns null when avgDamage is negative', () => {
      expect(calculateDamagePercentage(100000, -50000)).toBeNull()
    })

    it('returns null when damage is zero', () => {
      expect(calculateDamagePercentage(0, 100000)).toBeNull()
    })

    it('returns null when damage is negative', () => {
      expect(calculateDamagePercentage(-100000, 100000)).toBeNull()
    })

    it('calculates positive percentage correctly', () => {
      expect(calculateDamagePercentage(120000, 100000)).toBe(20)
    })

    it('calculates negative percentage correctly', () => {
      expect(calculateDamagePercentage(80000, 100000)).toBe(-20)
    })

    it('returns zero for equal values', () => {
      expect(calculateDamagePercentage(100000, 100000)).toBe(0)
    })

    it('handles large percentage differences', () => {
      expect(calculateDamagePercentage(300000, 100000)).toBe(200)
    })

    it('handles fractional percentages', () => {
      expect(calculateDamagePercentage(105000, 100000)).toBe(5)
    })
  })

  describe('formatDamagePercentage', () => {
    it('returns -- for null', () => {
      expect(formatDamagePercentage(null)).toBe('--')
    })

    it('formats positive percentage with plus sign', () => {
      expect(formatDamagePercentage(25)).toBe('+25%')
    })

    it('formats negative percentage with minus sign', () => {
      expect(formatDamagePercentage(-15)).toBe('-15%')
    })

    it('formats zero with plus sign', () => {
      expect(formatDamagePercentage(0)).toBe('+0%')
    })

    it('rounds to whole number', () => {
      expect(formatDamagePercentage(25.7)).toBe('+26%')
      expect(formatDamagePercentage(25.3)).toBe('+25%')
      expect(formatDamagePercentage(-15.6)).toBe('-16%')
    })

    it('handles large percentages', () => {
      expect(formatDamagePercentage(150)).toBe('+150%')
      expect(formatDamagePercentage(-75)).toBe('-75%')
    })
  })

  describe('getDamagePercentageColor', () => {
    it('returns tertiary color for null', () => {
      expect(getDamagePercentageColor(null)).toBe('text-[var(--text-tertiary)]')
    })

    it('returns bright green for >= 20%', () => {
      expect(getDamagePercentageColor(20)).toBe('text-green-400')
      expect(getDamagePercentageColor(50)).toBe('text-green-400')
      expect(getDamagePercentageColor(100)).toBe('text-green-400')
    })

    it('returns dimmer green for 0-20%', () => {
      expect(getDamagePercentageColor(0)).toBe('text-green-300/80')
      expect(getDamagePercentageColor(10)).toBe('text-green-300/80')
      expect(getDamagePercentageColor(19)).toBe('text-green-300/80')
    })

    it('returns yellow for -20% to 0%', () => {
      expect(getDamagePercentageColor(-1)).toBe('text-yellow-400')
      expect(getDamagePercentageColor(-10)).toBe('text-yellow-400')
      expect(getDamagePercentageColor(-20)).toBe('text-yellow-400')
    })

    it('returns red for < -20%', () => {
      expect(getDamagePercentageColor(-21)).toBe('text-red-400')
      expect(getDamagePercentageColor(-50)).toBe('text-red-400')
      expect(getDamagePercentageColor(-100)).toBe('text-red-400')
    })
  })
})

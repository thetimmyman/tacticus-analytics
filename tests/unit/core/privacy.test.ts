import { describe, it, expect } from 'vitest'
import {
  MIN_OBFUSCATION_PERCENT,
  MAX_OBFUSCATION_PERCENT,
  DEFAULT_OBFUSCATION_PERCENT,
  normalizeObfuscationPercent
} from '@tacticus/app-core/privacy'

describe('Privacy Utilities', () => {
  describe('Constants', () => {
    it('has correct MIN_OBFUSCATION_PERCENT', () => {
      expect(MIN_OBFUSCATION_PERCENT).toBe(1)
    })

    it('has correct MAX_OBFUSCATION_PERCENT', () => {
      expect(MAX_OBFUSCATION_PERCENT).toBe(30)
    })

    it('has correct DEFAULT_OBFUSCATION_PERCENT', () => {
      expect(DEFAULT_OBFUSCATION_PERCENT).toBe(10)
    })

    it('MIN is less than MAX', () => {
      expect(MIN_OBFUSCATION_PERCENT).toBeLessThan(MAX_OBFUSCATION_PERCENT)
    })

    it('DEFAULT is between MIN and MAX', () => {
      expect(DEFAULT_OBFUSCATION_PERCENT).toBeGreaterThanOrEqual(
        MIN_OBFUSCATION_PERCENT
      )
      expect(DEFAULT_OBFUSCATION_PERCENT).toBeLessThanOrEqual(
        MAX_OBFUSCATION_PERCENT
      )
    })
  })

  describe('normalizeObfuscationPercent', () => {
    describe('null/undefined handling', () => {
      it('returns default for null', () => {
        expect(normalizeObfuscationPercent(null)).toBe(
          DEFAULT_OBFUSCATION_PERCENT
        )
      })

      it('returns default for undefined', () => {
        expect(normalizeObfuscationPercent(undefined)).toBe(
          DEFAULT_OBFUSCATION_PERCENT
        )
        expect(normalizeObfuscationPercent()).toBe(DEFAULT_OBFUSCATION_PERCENT)
      })
    })

    describe('non-finite number handling', () => {
      it('returns default for NaN', () => {
        expect(normalizeObfuscationPercent(NaN)).toBe(
          DEFAULT_OBFUSCATION_PERCENT
        )
      })

      it('returns default for Infinity', () => {
        expect(normalizeObfuscationPercent(Infinity)).toBe(
          DEFAULT_OBFUSCATION_PERCENT
        )
      })

      it('returns default for -Infinity', () => {
        expect(normalizeObfuscationPercent(-Infinity)).toBe(
          DEFAULT_OBFUSCATION_PERCENT
        )
      })
    })

    describe('clamping behavior', () => {
      it('clamps values below MIN to MIN', () => {
        expect(normalizeObfuscationPercent(0)).toBe(MIN_OBFUSCATION_PERCENT)
        expect(normalizeObfuscationPercent(-5)).toBe(MIN_OBFUSCATION_PERCENT)
        expect(normalizeObfuscationPercent(-100)).toBe(MIN_OBFUSCATION_PERCENT)
      })

      it('clamps values above MAX to MAX', () => {
        expect(normalizeObfuscationPercent(31)).toBe(MAX_OBFUSCATION_PERCENT)
        expect(normalizeObfuscationPercent(50)).toBe(MAX_OBFUSCATION_PERCENT)
        expect(normalizeObfuscationPercent(100)).toBe(MAX_OBFUSCATION_PERCENT)
      })

      it('returns value unchanged when in valid range', () => {
        expect(normalizeObfuscationPercent(1)).toBe(1)
        expect(normalizeObfuscationPercent(10)).toBe(10)
        expect(normalizeObfuscationPercent(15)).toBe(15)
        expect(normalizeObfuscationPercent(30)).toBe(30)
      })
    })

    describe('rounding behavior', () => {
      it('rounds to nearest integer', () => {
        expect(normalizeObfuscationPercent(10.4)).toBe(10)
        expect(normalizeObfuscationPercent(10.5)).toBe(11)
        expect(normalizeObfuscationPercent(10.6)).toBe(11)
      })

      it('rounds before clamping', () => {
        expect(normalizeObfuscationPercent(0.6)).toBe(1)
        expect(normalizeObfuscationPercent(0.4)).toBe(1)
        expect(normalizeObfuscationPercent(30.4)).toBe(30)
        expect(normalizeObfuscationPercent(30.6)).toBe(30)
      })
    })

    describe('edge cases', () => {
      it('handles exact boundary values', () => {
        expect(normalizeObfuscationPercent(MIN_OBFUSCATION_PERCENT)).toBe(
          MIN_OBFUSCATION_PERCENT
        )
        expect(normalizeObfuscationPercent(MAX_OBFUSCATION_PERCENT)).toBe(
          MAX_OBFUSCATION_PERCENT
        )
      })

      it('handles very small positive values', () => {
        expect(normalizeObfuscationPercent(0.001)).toBe(MIN_OBFUSCATION_PERCENT)
        expect(normalizeObfuscationPercent(0.999)).toBe(MIN_OBFUSCATION_PERCENT)
      })

      it('handles very large values', () => {
        expect(normalizeObfuscationPercent(1000000)).toBe(
          MAX_OBFUSCATION_PERCENT
        )
      })
    })
  })
})

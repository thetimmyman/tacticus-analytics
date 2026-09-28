import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  formatNumber,
  formatDamage,
  formatPercentage,
  formatPercentageDiff,
  formatDuration
} from '@tacticus/app-core/formatters'

describe('Formatters', () => {
  describe('formatNumber', () => {
    describe('locale-independent grouping', () => {
      afterEach(() => vi.restoreAllMocks())

      it('keeps integer grouping stable when the runtime default is German', () => {
        const original = Number.prototype.toLocaleString
        vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(
          function (this: number, locales, options) {
            return original.call(this, locales ?? 'de-DE', options)
          }
        )

        expect(formatNumber(12345)).toBe('12,345')
        expect(formatNumber(-1234)).toBe('-1,234')
        expect(formatNumber(1234567000, 2)).toBe('1.23B')
      })
    })

    describe('null/undefined/NaN handling', () => {
      it('returns "0" for null', () => {
        expect(formatNumber(null)).toBe('0')
      })

      it('returns "0" for undefined', () => {
        expect(formatNumber(undefined)).toBe('0')
      })

      it('returns "0" for NaN', () => {
        expect(formatNumber(NaN)).toBe('0')
      })
    })

    describe('small numbers (< 100,000)', () => {
      it('formats zero as "0"', () => {
        expect(formatNumber(0)).toBe('0')
      })

      it('formats small numbers with commas', () => {
        expect(formatNumber(1234)).toBe('1,234')
        expect(formatNumber(99999)).toBe('99,999')
      })

      it('rounds to nearest integer', () => {
        expect(formatNumber(1234.5)).toBe('1,235')
        expect(formatNumber(1234.4)).toBe('1,234')
      })
    })

    describe('thousands (100,000 - 999,499)', () => {
      it('formats as ###k', () => {
        expect(formatNumber(100000)).toBe('100k')
        expect(formatNumber(500000)).toBe('500k')
        expect(formatNumber(999499)).toBe('999k')
      })

      it('rounds to nearest thousand', () => {
        expect(formatNumber(150500)).toBe('151k')
        expect(formatNumber(150499)).toBe('150k')
      })
    })

    describe('millions (999,500+)', () => {
      it('formats as ###.##M', () => {
        expect(formatNumber(999500)).toBe('1.00M')
        expect(formatNumber(1000000)).toBe('1.00M')
        expect(formatNumber(1500000)).toBe('1.50M')
        expect(formatNumber(10000000)).toBe('10.00M')
        expect(formatNumber(100000000)).toBe('100.00M')
      })

      it('uses 2 decimal places by default', () => {
        expect(formatNumber(1234567)).toBe('1.23M')
        expect(formatNumber(1555555)).toBe('1.56M')
      })

      it('handles decimals=0 without showing undefined', () => {
        expect(formatNumber(1500000, 0)).toBe('2M')
        expect(formatNumber(999500, 0)).toBe('1M')
        expect(formatNumber(10000000, 0)).toBe('10M')
        expect(formatNumber(150000000, 0)).toBe('150M')
      })
    })

    describe('billions (>= 1B)', () => {
      it('formats as ###.##B', () => {
        expect(formatNumber(1000000000)).toBe('1.00B')
        expect(formatNumber(1500000000)).toBe('1.50B')
        expect(formatNumber(10000000000)).toBe('10.00B')
      })

      it('handles large billions', () => {
        expect(formatNumber(100000000000)).toBe('100.00B')
        expect(formatNumber(999000000000)).toBe('999.00B')
      })

      it('handles decimals=0 without showing undefined', () => {
        expect(formatNumber(1500000000, 0)).toBe('2B')
        expect(formatNumber(10000000000, 0)).toBe('10B')
        expect(formatNumber(150000000000, 0)).toBe('150B')
      })
    })

    describe('trillions (>= 999.5T)', () => {
      it('formats as ###.##T', () => {
        expect(formatNumber(1000000000000)).toBe('1.00T')
        expect(formatNumber(10000000000000)).toBe('10.00T')
      })

      it('handles decimals=0 without showing undefined', () => {
        expect(formatNumber(1500000000000, 0)).toBe('2T')
        expect(formatNumber(10000000000000, 0)).toBe('10T')
      })
    })

    describe('negative numbers', () => {
      it('handles negative small numbers', () => {
        expect(formatNumber(-1234)).toBe('-1,234')
      })

      it('handles negative thousands', () => {
        expect(formatNumber(-150000)).toBe('-150k')
      })

      it('handles negative millions', () => {
        expect(formatNumber(-1500000)).toBe('-1.50M')
      })

      it('handles negative billions', () => {
        expect(formatNumber(-1500000000)).toBe('-1.50B')
      })
    })
  })

  describe('formatDamage', () => {
    it('always returns positive value', () => {
      expect(formatDamage(-1000000)).toBe('1.00M')
      expect(formatDamage(1000000)).toBe('1.00M')
    })

    it('handles null/undefined', () => {
      expect(formatDamage(null)).toBe('0')
      expect(formatDamage(undefined)).toBe('0')
    })

    it('uses 2 decimal places by default', () => {
      expect(formatDamage(1234567)).toBe('1.23M')
    })
  })

  describe('formatPercentage', () => {
    it('returns "0%" for null/undefined/NaN', () => {
      expect(formatPercentage(null)).toBe('0%')
      expect(formatPercentage(undefined)).toBe('0%')
      expect(formatPercentage(NaN)).toBe('0%')
    })

    it('returns "0%" for Infinity and -Infinity', () => {
      expect(formatPercentage(Infinity)).toBe('0%')
      expect(formatPercentage(-Infinity)).toBe('0%')
    })

    it('converts decimal to percentage', () => {
      expect(formatPercentage(0.15)).toBe('15%')
      expect(formatPercentage(0.5)).toBe('50%')
      expect(formatPercentage(1)).toBe('100%')
    })

    it('uses 0 decimal places by default', () => {
      expect(formatPercentage(0.156)).toBe('16%')
    })

    it('respects decimal places parameter', () => {
      expect(formatPercentage(0.1567, 1)).toBe('15.7%')
      expect(formatPercentage(0.1567, 2)).toBe('15.67%')
    })

    it('handles values over 100%', () => {
      expect(formatPercentage(1.5)).toBe('150%')
      expect(formatPercentage(2)).toBe('200%')
    })
  })

  describe('formatPercentageDiff', () => {
    it('returns "0%" for null/undefined/NaN', () => {
      expect(formatPercentageDiff(null)).toBe('0%')
      expect(formatPercentageDiff(undefined)).toBe('0%')
      expect(formatPercentageDiff(NaN)).toBe('0%')
    })

    it('returns "0%" for Infinity and -Infinity', () => {
      expect(formatPercentageDiff(Infinity)).toBe('0%')
      expect(formatPercentageDiff(-Infinity)).toBe('0%')
    })

    it('adds + prefix for positive values', () => {
      expect(formatPercentageDiff(15)).toBe('+15%')
      expect(formatPercentageDiff(0.5)).toBe('+1%')
    })

    it('preserves - prefix for negative values', () => {
      expect(formatPercentageDiff(-10)).toBe('-10%')
      expect(formatPercentageDiff(-0.5)).toBe('-1%')
    })

    it('handles zero', () => {
      expect(formatPercentageDiff(0)).toBe('+0%')
    })

    it('respects decimal places parameter', () => {
      expect(formatPercentageDiff(15.67, 1)).toBe('+15.7%')
      expect(formatPercentageDiff(-15.67, 2)).toBe('-15.67%')
    })
  })

  describe('formatDuration', () => {
    it('returns "0m" for null/undefined/NaN/zero/negative', () => {
      expect(formatDuration(null)).toBe('0m')
      expect(formatDuration(undefined)).toBe('0m')
      expect(formatDuration(NaN)).toBe('0m')
      expect(formatDuration(0)).toBe('0m')
      expect(formatDuration(-60)).toBe('0m')
    })

    it('formats minutes only', () => {
      expect(formatDuration(60)).toBe('1m')
      expect(formatDuration(300)).toBe('5m')
      expect(formatDuration(3540)).toBe('59m')
    })

    it('formats hours only when no remaining minutes', () => {
      expect(formatDuration(3600)).toBe('1h')
      expect(formatDuration(7200)).toBe('2h')
    })

    it('formats hours and minutes', () => {
      expect(formatDuration(3660)).toBe('1h 1m')
      expect(formatDuration(5400)).toBe('1h 30m')
      expect(formatDuration(9000)).toBe('2h 30m')
    })

    it('handles large durations', () => {
      expect(formatDuration(86400)).toBe('24h')
      expect(formatDuration(90000)).toBe('25h')
    })
  })
})

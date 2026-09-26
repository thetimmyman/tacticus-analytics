import { describe, it, expect } from 'vitest'
import { formatNumber } from '@/app/lib/utils/number-format'

const compact = (v: number, decimals?: number) =>
  formatNumber(v, {
    style: 'compact',
    ...(decimals === undefined ? {} : { decimals })
  })

describe('formatNumber (compact)', () => {
  it('formats ordinary magnitudes correctly', () => {
    expect(compact(0)).toBe('0')
    expect(compact(5)).toBe('5')
    expect(compact(999)).toBe('999')
    expect(compact(1_500)).toBe('1.5K')
    expect(compact(1_500_000)).toBe('1.5M')
    expect(compact(2_500_000_000)).toBe('2.5B')
    expect(compact(-1_500)).toBe('-1.5K')
  })

  it('REGRESSION: a value that rounds up across a boundary promotes the suffix (no "1000.0K")', () => {
    expect(compact(999_999)).toBe('1.0M')
    expect(compact(999_999.5)).toBe('1.0M')
    // Every integer in [999_950, 1_000_000) must not print "1000.0K".
    expect(compact(999_950)).toBe('1.0M')
  })

  it('REGRESSION: M→B boundary promotes too', () => {
    expect(compact(999_999_999.5)).toBe('1.0B')
    expect(compact(999_950_000)).toBe('1.0B')
  })

  it('REGRESSION: sub-thousand round-up promotes to K (no bare "1000")', () => {
    expect(compact(999.95)).toBe('1.0K')
  })

  it('REGRESSION: promotion is decimals-aware (decimals=2 window is narrower)', () => {
    // At decimals=2 the round-up threshold is ~999.995/scale, so 999_995 → 1.00M.
    expect(compact(999_995, 2)).toBe('1.00M')
    expect(compact(999_990, 2)).toBe('999.99K')
  })

  it('REGRESSION: decimals=0 promotes correctly', () => {
    expect(compact(999_500, 0)).toBe('1M')
    expect(compact(999_999, 0)).toBe('1M')
  })

  it('never emits a 4-digit mantissa for values below the billions tier', () => {
    for (const decimals of [0, 1, 2]) {
      for (const v of [
        999_949, 999_950, 999_999, 1_000_000, 999_994_999, 999_999_999, 999.94,
        999.95, 1234, 1_234_567
      ]) {
        const out = compact(v, decimals)
        const mantissa = parseFloat(out.replace(/[KMB-]/g, ''))
        expect(mantissa).toBeLessThan(1000)
      }
    }
  })

  it('top-tier billions retains a large mantissa (no higher unit to promote to)', () => {
    // ~1e12 has no "T" tier, so a 4-digit B mantissa is expected here.
    expect(compact(999_999_999_999.5)).toBe('1000.0B')
  })
})

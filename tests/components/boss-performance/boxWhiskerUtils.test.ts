import { describe, expect, it } from 'vitest'
import { buildBoxWhiskerStats } from '@/app/components/boss-performance/boxWhiskerUtils'

describe('buildBoxWhiskerStats', () => {
  it('returns null when no valid values are present', () => {
    const stats = buildBoxWhiskerStats('Sample', [0, -5, Number.NaN])

    expect(stats).toBeNull()
  })

  it('calculates quartiles for sorted samples', () => {
    const stats = buildBoxWhiskerStats('Sample', [10, 20, 30, 40])

    expect(stats).not.toBeNull()
    expect(stats?.min).toBe(10)
    expect(stats?.max).toBe(40)
    expect(stats?.sampleSize).toBe(4)
    expect(stats?.q1).toBeCloseTo(17.5, 5)
    expect(stats?.median).toBeCloseTo(25, 5)
    expect(stats?.q3).toBeCloseTo(32.5, 5)
  })

  it('filters non-finite values before computing stats', () => {
    const stats = buildBoxWhiskerStats('Filtered', [
      5,
      Number.POSITIVE_INFINITY,
      15
    ])

    expect(stats?.sampleSize).toBe(2)
    expect(stats?.min).toBe(5)
    expect(stats?.max).toBe(15)
  })
})

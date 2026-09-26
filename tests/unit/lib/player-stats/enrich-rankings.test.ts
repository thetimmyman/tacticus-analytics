import { describe, it, expect } from 'vitest'
import { computeReliabilityFallback } from '@/app/lib/player-stats/enrich-rankings'

describe('computeReliabilityFallback', () => {
  it('returns null for undefined bossDetails', () => {
    expect(computeReliabilityFallback(undefined)).toBeNull()
  })

  it('returns null for empty bossDetails', () => {
    expect(computeReliabilityFallback([])).toBeNull()
  })

  it('returns null for single boss (need 2+ for variance)', () => {
    expect(computeReliabilityFallback([{ vsGuild: 10 }])).toBeNull()
  })

  it('returns 100 for identical boss values (zero variance)', () => {
    const result = computeReliabilityFallback([
      { vsGuild: 10 },
      { vsGuild: 10 },
      { vsGuild: 10 }
    ])
    expect(result).toBe(100)
  })

  it('returns high score for low variance', () => {
    const result = computeReliabilityFallback([
      { vsGuild: 9 },
      { vsGuild: 10 },
      { vsGuild: 11 }
    ])
    expect(result).toBeGreaterThan(90)
  })

  it('returns lower score for high variance', () => {
    const result = computeReliabilityFallback([
      { vsGuild: -50 },
      { vsGuild: 100 }
    ])
    expect(result).toBeLessThan(50)
  })

  it('handles all-negative vsGuild values', () => {
    const result = computeReliabilityFallback([
      { vsGuild: -10 },
      { vsGuild: -12 },
      { vsGuild: -8 }
    ])
    expect(result).toBeGreaterThan(90)
  })

  it('filters out NaN and non-numeric vsGuild values', () => {
    const result = computeReliabilityFallback([
      { vsGuild: 10 },
      { vsGuild: undefined },
      { vsGuild: 10 }
    ])
    expect(result).toBe(100)
  })

  it('returns score clamped to 0 minimum', () => {
    const result = computeReliabilityFallback([
      { vsGuild: -99 },
      { vsGuild: 500 }
    ])
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('returns a number with one decimal place', () => {
    const result = computeReliabilityFallback([
      { vsGuild: 5 },
      { vsGuild: 15 },
      { vsGuild: 25 }
    ])
    expect(result).not.toBeNull()
    const decimals = result!.toString().split('.')[1]?.length ?? 0
    expect(decimals).toBeLessThanOrEqual(1)
  })
})

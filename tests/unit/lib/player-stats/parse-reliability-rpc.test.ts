import { describe, it, expect } from 'vitest'
import { parseReliabilityRpc } from '@/app/components/playerstats/hooks/useFetchPlayerStats'

/** A NULL below 2 battles and a real 0 score differ only by a null check before coercion. */
describe('parseReliabilityRpc', () => {
  it('keeps a NULL score null instead of coercing it to 0', () => {
    const parsed = parseReliabilityRpc({
      reliability_score: null,
      consistency_rating: 'Insufficient Data (Min 2 battles)',
      avg_performance: 1234,
      performance_stddev: null,
      coefficient_of_variation: null,
      battles_analyzed: 1,
      performance_range_min: null,
      performance_range_max: null
    })

    expect(parsed.reliability_score).toBeNull()
    expect(parsed.consistency_rating).toBe('Insufficient Data (Min 2 battles)')
    expect(parsed.battles_analyzed).toBe(1)
  })

  it('treats a missing score the same as an explicit NULL', () => {
    expect(parseReliabilityRpc({}).reliability_score).toBeNull()
    expect(
      parseReliabilityRpc({ reliability_score: undefined }).reliability_score
    ).toBeNull()
  })

  it('preserves a genuine zero score', () => {
    // A maximally volatile player really scores 0; must not become "no data".
    const parsed = parseReliabilityRpc({
      reliability_score: 0,
      consistency_rating: 'Volatile',
      battles_analyzed: 12
    })

    expect(parsed.reliability_score).toBe(0)
    expect(parsed.consistency_rating).toBe('Volatile')
  })

  it('parses a normal scored row', () => {
    const parsed = parseReliabilityRpc({
      reliability_score: 87.4,
      consistency_rating: 'Very Consistent',
      avg_performance: 2_000_000,
      performance_stddev: 250_000,
      coefficient_of_variation: 12.6,
      battles_analyzed: 20,
      performance_range_min: 1_500_000,
      performance_range_max: 2_400_000
    })

    expect(parsed.reliability_score).toBe(87.4)
    expect(parsed.coefficient_of_variation).toBe(12.6)
    expect(parsed.performance_range_max).toBe(2_400_000)
  })

  it('rejects a non-numeric score rather than reporting NaN', () => {
    const parsed = parseReliabilityRpc({
      reliability_score: 'not-a-number'
    } as unknown as Parameters<typeof parseReliabilityRpc>[0])

    expect(parsed.reliability_score).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { analyzeBossPerformanceAnomalies } from '@/app/lib/ml/anomaly-detection'

describe('ML Anomaly Detection Service', () => {
  it('prefers historical samples when enough valid data exists', () => {
    const result = analyzeBossPerformanceAnomalies({
      bossId: 'L1-Mortarion-0',
      averageDamagePerHit: 100_000,
      hitCount: 24,
      averageTimeToKill: 14,
      historicalSamples: [
        { damage: 96_000, tokenUsage: 6, durationMinutes: 14 },
        { damage: 101_000, tokenUsage: 7, durationMinutes: 13 },
        { damage: 98_000, tokenUsage: 6, durationMinutes: 15 },
        { damage: 103_000, tokenUsage: 7, durationMinutes: 14 },
        { damage: 99_000, tokenUsage: 6, durationMinutes: 14 },
        { damage: 100_500, tokenUsage: 6, durationMinutes: 14 }
      ]
    })

    expect(result.source).toBe('historical')
    expect(result.sampleSize).toBeGreaterThanOrEqual(6)
    expect(result.consistencyScore?.score).toBeGreaterThan(0)
    expect(result.trendAnalysis).toBeDefined()
    expect(result.performanceStats).toBeDefined()
  })

  it('falls back deterministically when historical samples are sparse', () => {
    const input = {
      bossId: 'M3-Szarekh-1',
      averageDamagePerHit: 210_000,
      hitCount: 18,
      averageTimeToKill: 11,
      historicalSamples: [{ damage: 200_000 }]
    }

    const first = analyzeBossPerformanceAnomalies(input)
    const second = analyzeBossPerformanceAnomalies(input)

    expect(first.source).toBe('fallback')
    expect(second.source).toBe('fallback')
    expect(first.sampleSize).toBe(second.sampleSize)
    expect(first.performanceStats?.mean).toBeCloseTo(
      second.performanceStats?.mean ?? 0,
      6
    )
    expect(first.riskLevel).toBe(second.riskLevel)
  })

  it('returns insufficient_data for low-hit cold starts', () => {
    const result = analyzeBossPerformanceAnomalies({
      bossId: 'L2-ColdStart-0',
      averageDamagePerHit: 50_000,
      hitCount: 3,
      averageTimeToKill: null,
      historicalSamples: []
    })

    expect(result.source).toBe('insufficient_data')
    expect(result.consistencyScore).toBeUndefined()
    expect(result.performanceStats).toBeUndefined()
    expect(result.trendAnalysis).toBeUndefined()
  })

  it('ignores invalid historical rows and still produces a safe result', () => {
    const result = analyzeBossPerformanceAnomalies({
      bossId: 'L5-InvalidRows-0',
      averageDamagePerHit: 75_000,
      hitCount: 10,
      averageTimeToKill: 20,
      historicalSamples: [
        { damage: Number.NaN, tokenUsage: 4, durationMinutes: 10 },
        { damage: -1, tokenUsage: 4, durationMinutes: 10 },
        { damage: 70_000, tokenUsage: Number.NaN, durationMinutes: 20 },
        { damage: 78_000, tokenUsage: 5, durationMinutes: 21 }
      ]
    })

    expect(['historical', 'fallback']).toContain(result.source)
    expect(result.sampleSize).toBeGreaterThan(0)
  })
})

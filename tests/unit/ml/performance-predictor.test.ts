import { describe, expect, it } from 'vitest'
import { buildBossMlInsight } from '@/app/lib/ml/performance-predictor'

describe('ML Performance Predictor Service', () => {
  it('produces a historical prediction with bounded interval and confidence', () => {
    const result = buildBossMlInsight({
      bossId: 'L4-Historical-0',
      averageDamagePerHit: 120_000,
      hitCount: 22,
      averageTimeToKill: 13,
      historicalSamples: [
        { damage: 110_000, tokenUsage: 6, durationMinutes: 14 },
        { damage: 119_000, tokenUsage: 6, durationMinutes: 13 },
        { damage: 122_000, tokenUsage: 7, durationMinutes: 12 },
        { damage: 118_000, tokenUsage: 6, durationMinutes: 13 },
        { damage: 121_000, tokenUsage: 7, durationMinutes: 13 },
        { damage: 123_000, tokenUsage: 6, durationMinutes: 12 }
      ]
    })

    expect(result.source).toBe('historical')
    expect(result.prediction.basis).toBe('historical')
    expect(result.prediction.confidence).toBeGreaterThanOrEqual(70)
    expect(result.prediction.confidenceInterval[0]).toBeGreaterThanOrEqual(0)
    expect(result.prediction.confidenceInterval[1]).toBeGreaterThanOrEqual(
      result.prediction.confidenceInterval[0]
    )
  })

  it('produces fallback prediction when historical coverage is not enough', () => {
    const result = buildBossMlInsight({
      bossId: 'M1-Fallback-0',
      averageDamagePerHit: 180_000,
      hitCount: 12,
      averageTimeToKill: 10,
      historicalSamples: [{ damage: 170_000 }]
    })

    expect(result.source).toBe('fallback')
    expect(result.prediction.basis).toBe('fallback')
    expect(result.prediction.expectedDamagePerHit).toBe(180_000)
    expect(result.prediction.confidence).toBeGreaterThanOrEqual(45)
  })

  it('returns zeroed prediction when expected damage is unavailable', () => {
    const result = buildBossMlInsight({
      bossId: 'L1-Zero-0',
      averageDamagePerHit: 0,
      hitCount: 0,
      averageTimeToKill: null,
      historicalSamples: []
    })

    expect(result.source).toBe('insufficient_data')
    expect(result.prediction.expectedDamagePerHit).toBe(0)
    expect(result.prediction.confidenceInterval).toEqual([0, 0])
    expect(result.prediction.confidence).toBe(0)
  })
})

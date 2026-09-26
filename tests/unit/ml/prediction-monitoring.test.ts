import { describe, it, expect } from 'vitest'
import {
  assessPredictionDrift,
  summarizeAnomalyValidation,
  summarizePredictionAccuracy
} from '@/app/lib/ml/prediction-monitoring'
import type { MlInferenceInputRow } from '@/app/lib/ml/api-types'

function row(overrides: Partial<MlInferenceInputRow>): MlInferenceInputRow {
  return {
    segmentKey: 'L1 Mortarion',
    season: '83',
    bossType: 'Mortarion',
    encounterIndex: 0,
    rarity: 'Legendary',
    setNum: 0,
    raritySet: 'L1',
    latestLoopIndex: 7,
    latestLoopAvgDamage: 100000,
    latestLoopAttackCount: 12,
    rolling3AvgDamage: 99000,
    trendVsPrevPct: 4,
    metaAttackCount: 120,
    metaDamageAvg: 98000,
    metaDamageP75: 90000,
    metaDamageP90: 110000,
    recommendedBaselineDamage: 100000,
    benchmarkDeltaPct: 0,
    uncertaintyPct: 20,
    expectedRange: { low: 90000, high: 110000 },
    confidenceTier: 'high',
    coldStartReason: null,
    isColdStart: false,
    hasMetaBaseline: true,
    generatedAt: '2026-02-14T12:00:00.000Z',
    ...overrides
  }
}

describe('prediction monitoring', () => {
  it('summarizes accuracy coverage and mape from measurable rows', () => {
    const summary = summarizePredictionAccuracy([
      row({ latestLoopAvgDamage: 102000 }),
      row({ latestLoopAvgDamage: 89000 }),
      row({ latestLoopAvgDamage: 120000 })
    ])

    expect(summary.sampleSize).toBe(3)
    expect(summary.inRangeCount).toBe(1)
    expect(summary.coveragePct).toBeCloseTo(33.3, 1)
    expect(summary.mapePct).toBeCloseTo(11, 1)
  })

  it('marks drift as critical when mape is high', () => {
    const summary = summarizePredictionAccuracy([
      row({ latestLoopAvgDamage: 70000 }),
      row({ latestLoopAvgDamage: 72000 }),
      row({ latestLoopAvgDamage: 68000 }),
      row({ latestLoopAvgDamage: 69000 }),
      row({ latestLoopAvgDamage: 71000 })
    ])

    const drift = assessPredictionDrift(summary)
    expect(drift.status).toBe('critical')
    expect(drift.reasons).toContain('high_mape')
  })

  it('builds anomaly false-positive and false-negative counts', () => {
    const summary = summarizeAnomalyValidation([
      row({ trendVsPrevPct: -12, benchmarkDeltaPct: -15 }), // TP
      row({ trendVsPrevPct: -9, benchmarkDeltaPct: -2 }), // FP
      row({ trendVsPrevPct: 2, benchmarkDeltaPct: -11 }), // FN
      row({ trendVsPrevPct: 1, benchmarkDeltaPct: 3 }) // TN
    ])

    expect(summary.sampleSize).toBe(4)
    expect(summary.truePositive).toBe(1)
    expect(summary.falsePositive).toBe(1)
    expect(summary.falseNegative).toBe(1)
    expect(summary.trueNegative).toBe(1)
    expect(summary.precisionPct).toBe(50)
    expect(summary.recallPct).toBe(50)
  })
})

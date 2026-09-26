import { analyzeBossPerformanceAnomalies } from '@/app/lib/ml/anomaly-detection'
import type { BossAnomalyInput, BossMlInsight } from '@/app/lib/ml/types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function buildBossMlInsight(input: BossAnomalyInput): BossMlInsight {
  const anomalyInsight = analyzeBossPerformanceAnomalies(input)
  const mean =
    input.averageDamagePerHit > 0
      ? input.averageDamagePerHit
      : (anomalyInsight.performanceStats?.mean ?? 0)

  if (mean <= 0) {
    return {
      ...anomalyInsight,
      prediction: {
        expectedDamagePerHit: 0,
        confidenceInterval: [0, 0],
        confidence: 0,
        basis: anomalyInsight.source,
        sampleSize: anomalyInsight.sampleSize
      }
    }
  }

  const standardDeviation =
    anomalyInsight.performanceStats?.standardDeviation ?? mean * 0.15
  const spreadMultiplier =
    anomalyInsight.source === 'historical'
      ? 1.5
      : anomalyInsight.source === 'fallback'
        ? 2
        : 2.5

  const lowerBound = Math.max(0, mean - standardDeviation * spreadMultiplier)
  const upperBound = Math.max(
    lowerBound,
    mean + standardDeviation * spreadMultiplier
  )

  const baseConfidence =
    anomalyInsight.source === 'historical'
      ? 70
      : anomalyInsight.source === 'fallback'
        ? 45
        : 20
  const sampleBonus = Math.min(20, anomalyInsight.sampleSize)
  const confidence = clamp(Math.round(baseConfidence + sampleBonus), 0, 95)

  return {
    ...anomalyInsight,
    prediction: {
      expectedDamagePerHit: mean,
      confidenceInterval: [Math.round(lowerBound), Math.round(upperBound)],
      confidence,
      basis: anomalyInsight.source,
      sampleSize: anomalyInsight.sampleSize
    }
  }
}

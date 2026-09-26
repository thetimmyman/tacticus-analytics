import type { MlInferenceInputRow } from '@/app/lib/ml/api-types'

export interface MlPredictionAccuracySummary {
  sampleSize: number
  inRangeCount: number
  coveragePct: number | null
  mapePct: number | null
  biasPct: number | null
  avgUncertaintyPct: number | null
}

export interface MlPredictionDriftAssessment {
  status: 'none' | 'watch' | 'critical'
  reasons: string[]
}

export interface MlAnomalyValidationSummary {
  sampleSize: number
  truePositive: number
  falsePositive: number
  trueNegative: number
  falseNegative: number
  precisionPct: number | null
  recallPct: number | null
}

const roundPct = (value: number): number => Math.round(value * 10) / 10

export function summarizePredictionAccuracy(
  rows: MlInferenceInputRow[]
): MlPredictionAccuracySummary {
  const measurable = rows.filter(
    (row) =>
      typeof row.latestLoopAvgDamage === 'number' &&
      row.latestLoopAvgDamage > 0 &&
      typeof row.recommendedBaselineDamage === 'number' &&
      row.recommendedBaselineDamage > 0 &&
      typeof row.expectedRange.low === 'number' &&
      typeof row.expectedRange.high === 'number'
  )

  if (measurable.length === 0) {
    return {
      sampleSize: 0,
      inRangeCount: 0,
      coveragePct: null,
      mapePct: null,
      biasPct: null,
      avgUncertaintyPct: null
    }
  }

  let inRangeCount = 0
  let absoluteErrorPctTotal = 0
  let signedErrorPctTotal = 0
  let uncertaintyTotal = 0
  let uncertaintyCount = 0

  for (const row of measurable) {
    const actual = row.latestLoopAvgDamage as number
    const baseline = row.recommendedBaselineDamage as number
    const expectedLow = row.expectedRange.low as number
    const expectedHigh = row.expectedRange.high as number

    if (actual >= expectedLow && actual <= expectedHigh) {
      inRangeCount += 1
    }

    const signedErrorPct = ((actual - baseline) / baseline) * 100
    signedErrorPctTotal += signedErrorPct
    absoluteErrorPctTotal += Math.abs(signedErrorPct)

    if (typeof row.uncertaintyPct === 'number') {
      uncertaintyTotal += row.uncertaintyPct
      uncertaintyCount += 1
    }
  }

  const sampleSize = measurable.length
  return {
    sampleSize,
    inRangeCount,
    coveragePct: roundPct((inRangeCount / sampleSize) * 100),
    mapePct: roundPct(absoluteErrorPctTotal / sampleSize),
    biasPct: roundPct(signedErrorPctTotal / sampleSize),
    avgUncertaintyPct:
      uncertaintyCount > 0
        ? roundPct(uncertaintyTotal / uncertaintyCount)
        : null
  }
}

export function assessPredictionDrift(
  summary: MlPredictionAccuracySummary
): MlPredictionDriftAssessment {
  if (summary.sampleSize === 0) {
    return { status: 'watch', reasons: ['no_samples'] }
  }

  const reasons: string[] = []

  if (summary.sampleSize < 5) {
    reasons.push('limited_sample')
  }
  if (typeof summary.mapePct === 'number' && summary.mapePct >= 20) {
    reasons.push('high_mape')
  }
  if (typeof summary.coveragePct === 'number' && summary.coveragePct < 50) {
    reasons.push('low_coverage')
  }
  if (
    typeof summary.avgUncertaintyPct === 'number' &&
    summary.avgUncertaintyPct > 35
  ) {
    reasons.push('high_uncertainty')
  }

  if (reasons.includes('high_mape') || reasons.includes('low_coverage')) {
    return { status: 'critical', reasons }
  }

  if (
    reasons.length > 0 ||
    (typeof summary.mapePct === 'number' && summary.mapePct >= 12) ||
    (typeof summary.coveragePct === 'number' && summary.coveragePct < 70)
  ) {
    if (!reasons.includes('elevated_drift')) {
      reasons.push('elevated_drift')
    }
    return { status: 'watch', reasons }
  }

  return { status: 'none', reasons: [] }
}

export function summarizeAnomalyValidation(
  rows: MlInferenceInputRow[],
  thresholds?: {
    predictedTrendPct?: number
    observedBenchmarkPct?: number
  }
): MlAnomalyValidationSummary {
  const predictedTrendPct = thresholds?.predictedTrendPct ?? -8
  const observedBenchmarkPct = thresholds?.observedBenchmarkPct ?? -10

  const measurable = rows.filter(
    (row) =>
      typeof row.trendVsPrevPct === 'number' &&
      typeof row.benchmarkDeltaPct === 'number'
  )

  if (measurable.length === 0) {
    return {
      sampleSize: 0,
      truePositive: 0,
      falsePositive: 0,
      trueNegative: 0,
      falseNegative: 0,
      precisionPct: null,
      recallPct: null
    }
  }

  let truePositive = 0
  let falsePositive = 0
  let trueNegative = 0
  let falseNegative = 0

  for (const row of measurable) {
    const predictedAnomaly = (row.trendVsPrevPct as number) <= predictedTrendPct
    const observedAnomaly =
      (row.benchmarkDeltaPct as number) <= observedBenchmarkPct

    if (predictedAnomaly && observedAnomaly) truePositive += 1
    else if (predictedAnomaly && !observedAnomaly) falsePositive += 1
    else if (!predictedAnomaly && observedAnomaly) falseNegative += 1
    else trueNegative += 1
  }

  const precisionDenominator = truePositive + falsePositive
  const recallDenominator = truePositive + falseNegative

  return {
    sampleSize: measurable.length,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precisionPct:
      precisionDenominator > 0
        ? roundPct((truePositive / precisionDenominator) * 100)
        : null,
    recallPct:
      recallDenominator > 0
        ? roundPct((truePositive / recallDenominator) * 100)
        : null
  }
}

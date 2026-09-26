import {
  analyzeTrend,
  calculateConsistencyScore,
  calculateStats,
  detectAnomalies,
  generatePerformanceInsights
} from '@/app/lib/analytics/performance-utils'
import type {
  BossAnomalyInput,
  BossAnomalyResult,
  BossHistoricalSample
} from '@/app/lib/ml/types'

const DEFAULT_MIN_SAMPLE_SIZE = 6
const DEFAULT_ANOMALY_THRESHOLD = 2

type Series = {
  damageValues: number[]
  tokenUsage: number[]
  timeToKill: number[]
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function hashToSeed(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) || 1
}

function createSeededRng(seed: number): () => number {
  let state = seed % 2147483647
  if (state <= 0) {
    state += 2147483646
  }

  return () => {
    state = (state * 48271) % 2147483647
    return (state - 1) / 2147483646
  }
}

function extractHistoricalSeries(samples: BossHistoricalSample[]): Series {
  const damageValues: number[] = []
  const tokenUsage: number[] = []
  const timeToKill: number[] = []

  for (const sample of samples) {
    if (isPositiveNumber(sample.damage)) {
      damageValues.push(sample.damage)
    }
    if (isPositiveNumber(sample.tokenUsage)) {
      tokenUsage.push(sample.tokenUsage)
    }
    if (isPositiveNumber(sample.durationMinutes)) {
      timeToKill.push(sample.durationMinutes)
    }
  }

  return { damageValues, tokenUsage, timeToKill }
}

function buildFallbackSeries(
  input: BossAnomalyInput,
  minSampleSize: number
): Series {
  const sampleSize = Math.max(
    minSampleSize,
    Math.min(20, Math.max(0, input.hitCount))
  )
  if (sampleSize === 0) {
    return { damageValues: [], tokenUsage: [], timeToKill: [] }
  }

  const seed = hashToSeed(
    `${input.bossId}:${input.averageDamagePerHit}:${input.hitCount}:${input.averageTimeToKill ?? 'null'}`
  )
  const rng = createSeededRng(seed)
  const damageBase = Math.max(1, input.averageDamagePerHit || 1)
  const tokenBase = Math.max(
    1,
    input.hitCount / Math.max(1, Math.ceil(sampleSize / 3))
  )
  const durationBase = Math.max(1, input.averageTimeToKill ?? 15)

  const damageValues: number[] = []
  const tokenUsage: number[] = []
  const timeToKill: number[] = []

  for (let i = 0; i < sampleSize; i += 1) {
    const damageJitter = 0.85 + rng() * 0.3
    const tokenJitter = 0.9 + rng() * 0.2
    const timeJitter = 0.9 + rng() * 0.2

    damageValues.push(damageBase * damageJitter)
    tokenUsage.push(tokenBase * tokenJitter)
    timeToKill.push(durationBase * timeJitter)
  }

  return { damageValues, tokenUsage, timeToKill }
}

export function analyzeBossPerformanceAnomalies(
  input: BossAnomalyInput
): BossAnomalyResult {
  const minSampleSize = input.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE
  const historicalSeries = extractHistoricalSeries(
    input.historicalSamples ?? []
  )

  let series: Series
  let source: BossAnomalyResult['source']

  if (historicalSeries.damageValues.length >= minSampleSize) {
    series = historicalSeries
    source = 'historical'
  } else if (input.hitCount >= minSampleSize) {
    series = buildFallbackSeries(input, minSampleSize)
    source = 'fallback'
  } else {
    return {
      sampleSize: historicalSeries.damageValues.length,
      source: 'insufficient_data'
    }
  }

  const safeTokenUsage =
    series.tokenUsage.length > 0
      ? series.tokenUsage
      : [Math.max(1, input.hitCount)]
  const safeTimeToKill =
    series.timeToKill.length > 0
      ? series.timeToKill
      : [Math.max(1, input.averageTimeToKill ?? 15)]
  const trendValues =
    safeTokenUsage.length >= 2 ? safeTokenUsage : series.damageValues

  const anomalyResult = detectAnomalies(
    series.damageValues,
    input.anomalyThreshold ?? DEFAULT_ANOMALY_THRESHOLD
  )
  const risk = generatePerformanceInsights({
    damageValues: series.damageValues,
    tokenUsage: safeTokenUsage,
    timeToKill: safeTimeToKill
  })

  return {
    consistencyScore: calculateConsistencyScore(series.damageValues),
    trendAnalysis: analyzeTrend(trendValues),
    performanceStats: calculateStats(series.damageValues),
    hasAnomalies: anomalyResult.isCurrentAnomaly,
    riskLevel: risk.riskLevel,
    sampleSize: series.damageValues.length,
    source
  }
}

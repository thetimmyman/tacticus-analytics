import type {
  ConsistencyScore,
  PerformanceStats,
  TrendAnalysis
} from '@/app/lib/analytics/performance-utils'

export type { ConsistencyScore, PerformanceStats, TrendAnalysis }

export type RiskLevel = 'low' | 'medium' | 'high'

export type AnalyticsSource = 'historical' | 'fallback' | 'insufficient_data'

export interface BossHistoricalSample {
  damage: number
  tokenUsage?: number
  durationMinutes?: number | null
  loopIndex?: number
}

export interface BossAnomalyInput {
  bossId: string
  averageDamagePerHit: number
  hitCount: number
  averageTimeToKill: number | null
  historicalSamples?: BossHistoricalSample[]
  anomalyThreshold?: number
  minSampleSize?: number
}

export interface BossAnomalyResult {
  consistencyScore?: ConsistencyScore
  trendAnalysis?: TrendAnalysis
  performanceStats?: PerformanceStats
  hasAnomalies?: boolean
  riskLevel?: RiskLevel
  sampleSize: number
  source: AnalyticsSource
}

export interface PerformancePrediction {
  expectedDamagePerHit: number
  confidenceInterval: [number, number]
  confidence: number
  basis: AnalyticsSource
  sampleSize: number
}

export interface BossMlInsight extends BossAnomalyResult {
  prediction: PerformancePrediction
}

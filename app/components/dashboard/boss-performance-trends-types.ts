import type {
  ConsistencyScore,
  PerformanceStats,
  TrendAnalysis
} from '@/app/lib/ml/types'
import { type TrendDirection } from './boss-performance-tooltips'

export type TargetFilter = 'all' | 'bosses' | 'primes'

export interface BossMetrics {
  name: string
  level: string
  averageDamagePerHit: number
  hitCount: number
  totalDamage: number
  maxDamage: number
  tokenEfficiency: number // Damage per token
  damageEfficiencyPct: number // Percentage of max hit
  averageTimeToKill: number | null // Average duration in minutes (null for incomplete bosses)
  lastLoopTimeToKill: number | null // Most recent loop duration (null for incomplete bosses)
  avgDamagePerHour: number | null // Average damage per hour (null for incomplete bosses)
  timeTrend: TrendDirection
  tokenTrend: TrendDirection
  durationTrend: TrendDirection // Time-to-kill trend
  timeChange: number
  tokenChange: number
  durationChange: number // Percentage change in kill time
  problemSeverity: 'low' | 'medium' | 'high'
  variance: number
  isTarget: 'boss' | 'prime' // Type of target
  encounterId: number // For sorting: 0 = main boss, 1+ = primes
  consistencyScore?: ConsistencyScore
  trendAnalysis?: TrendAnalysis
  performanceStats?: PerformanceStats
  hasAnomalies?: boolean
  riskLevel?: 'low' | 'medium' | 'high'
}

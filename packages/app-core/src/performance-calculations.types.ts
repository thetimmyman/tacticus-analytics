import type { PerformanceSummary } from './performance.types'

export type CompareMode = 'guild' | 'guild-boss' | 'cluster' | 'cluster-boss'

/**
 * battle-weighted: each battle counts equally; token-weighted: by tokens spent;
 * target-weighted: actual / expected damage, shown as (score - 1) x 100%.
 */
export type PerformanceMode =
  'battle-weighted' | 'token-weighted' | 'target-weighted'

export type TokenWeightingMode = 'max' | 'average'

export type TokenRatioMaps = Record<TokenWeightingMode, Map<string, number>>

export type BossPerformanceFilter = 'all' | 'positive' | 'negative'

export interface PerformanceBossStats {
  displayName: string
  boss_name: string
  overallTokenUsage?: string | null
  player_avg: number
  cluster_avg: number
  guild_avg: number
  vs_cluster_pct: number
  vs_guild_pct: number
  battle_count: number
  weighted_contribution: number
  tier?: number
  set?: number
  player_id?: string
  userId?: string
  is_current_member?: boolean
}

export interface PreparedPerformanceBossStat extends PerformanceBossStats {
  detailType: string
  performanceValue: number
}

export interface PreparedPerformanceSummary extends PerformanceSummary {
  performanceValue: number
  basePerformanceValue: number
  tokenRatioApplied: number
}

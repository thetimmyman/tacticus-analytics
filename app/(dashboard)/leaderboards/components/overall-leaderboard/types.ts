import type {
  PerformanceMode,
  TokenWeightingMode
} from '@/app/components/performance/types'

export interface OverallLeaderboardProps {
  season: string
  userGuild: string
}

export interface PlayerStats {
  displayName: string
  Guild: string
  userId: string | null
  stableKey: string
  totalDamage: number
  battleCount: number
  avgDamage: number
  battleDamageTotal: number
  bombsUsed: number
  bossesKilled: number
  allBattleCount: number
  allBossesKilled: number
  percentVsCluster?: number
  currentRank?: number
  priorSeasonRank?: number
  rankChange?: number
  fiveSeasonAvgRank?: number
}

export interface EnhancedPlayerStats extends PlayerStats {
  battleWeightedPercent: number | null
  tokenWeightedPercent: number | null
  tokenRatioApplied: number
  performanceValue: number | null
  scoreRank: number | null
}

export type SortField =
  | 'rank'
  | 'rankChange'
  | 'fiveSeasonAvg'
  | 'name'
  | 'guild'
  | 'totalDamage'
  | 'battles'
  | 'avgDamage'
  | 'percentVsCluster'
  | 'bombs'
  | 'kills'

export type SortDirection = 'asc' | 'desc'
export type ScoringMode = 'battle' | 'token-max' | 'token-average'

export interface ScoringPresentation {
  hasAnyTokenMode: boolean
  isTokenModeActive: boolean
  performanceMode: PerformanceMode
  tokenWeightingMode: TokenWeightingMode
  tokenMaxAvailable: boolean
  tokenAverageAvailable: boolean
  label: string
  tableLabel: string
  statusMessage: string
}

export const ITEMS_PER_PAGE = 15

import type { BoxWhiskerStats } from '@/app/components/boss-performance/boxWhiskerUtils'
import type { PlayerBossPerformance } from '@/app/lib/data/boss-performance'

export interface BossPerformanceParams {
  selectedGuild: string
  selectedSeason: string
  level: string
}

export interface PlayerBossStats {
  displayName: string
  avgDamage: number
  maxHit: number
  totalDamage: number
  tokenCount: number
  efficiency: number
}

export interface PrimeStats {
  displayName: string
  avgDamage: number
  tokenCount: number
  maxHit: number
  bossName?: string
}

export interface PrimeBossStats {
  bossName: string
  playerStats: PrimeStats[]
}

export interface LapTrend {
  lap: number
  avgDamage: number
  tokenCount: number
}

export interface TopStats {
  topTotalDamagePlayer: string
  topTotalDamage: number
  biggestHitPlayer: string
  biggestHit: number
  totalBossTokens: number
  totalPrimeTokens: number
  overallAvgDamage: number
}

export interface AssignedPlayers {
  primary: string[]
  secondary: string[]
}

export interface BossPerformanceOverview {
  bossName: string
  // Canonical CamelCase boss_type ("BelisariusRW") for Herald `boss_id` and similar APIs.
  bossType: string
  displayBossName: string
  topStats: TopStats
  playerStats: PlayerBossStats[]
  primeStats: PrimeStats[]
  primeBossStats: PrimeBossStats[]
  lapTrends: LapTrend[]
  mainDistribution: BoxWhiskerStats | null
  primeDistributions: BoxWhiskerStats[]
  assignedPlayers: AssignedPlayers
  hasPrimeData: boolean
  hasCluster: boolean
}

export type BossPerformanceSortField =
  'player' | 'avgGuild' | 'avgCluster' | 'preference'
export type BossPerformanceSortOrder = 'asc' | 'desc'

export interface BossPerformanceTableRow {
  playerName: string
  performances: NonNullable<PlayerBossPerformance[keyof PlayerBossPerformance]>
  avgGuild: number
  avgCluster: number
  preferenceScore: number
}

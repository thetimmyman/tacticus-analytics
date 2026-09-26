import type { PlayerMapping, PlayerRole } from '@tacticus/app-core/types'
export type { PlayerMapping } from '@tacticus/app-core/types'
import type {
  HistoricalPerformanceEntry,
  HistoricalDataSets,
  ReliabilityRpcResult
} from '@/app/lib/player-stats/types'
export type {
  HistoricalPerformanceEntry,
  HistoricalDataSets,
  ReliabilityRpcResult
}

export interface BossStatDetail {
  damage: number
  tokens: number
  avgDamage: number
  biggestHit: number
  vsClusterAvg: number
  vsGuildAvg: number
  crashes: number
  sweeps: number
  oneShots: number
  totalTokens: number
  totalDamageWithSweeps: number
  avgDamageWithSweeps: number
  set?: number
  rarity?: string
  clusterRank?: number
  totalPlayersOnBoss?: number
  guildRank?: number
  totalPlayersOnBossGuild?: number
  encounterId?: number
}

export interface PlayerReliability {
  reliability_score: number | null
  consistency_rating: string
  avg_performance: number
  performance_stddev: number
  coefficient_of_variation: number
  battles_analyzed: number
  performance_range_min: number
  performance_range_max: number
  season_used?: string
}

export interface PlayerStats {
  totalDamage: number
  avgDamagePerHit: number
  tokensUsed: number
  bombsUsed: number
  legendaryTokensUsed: number
  legendaryBombsUsed: number
  kills: number
  sweeps: number
  oneShots: number
  crashes: number
  vsClusterAvg: number
  vsGuildAvg: number
  bossStats: Record<string, BossStatDetail>
  primeStats: Record<string, BossStatDetail>
  historicalTokens: Record<string, number>
  historicalTotalDamage?: Record<string, number>
  historicalReliability?: Record<string, number>
  historicalPerformance?: Record<string, HistoricalPerformanceEntry>
  clusterRanking?: number
  totalPlayersInCluster?: number
  guildRanking?: number
  totalPlayersInGuild?: number
  reliability?: PlayerReliability
  playerKey?: string
}

export interface RankingUpdatePayload {
  season: string
  historicalPerformance: Record<string, HistoricalPerformanceEntry>
  historicalTokens: Record<string, number>
  historicalTotalDamage: Record<string, number>
  historicalReliability: Record<string, number>
  clusterRanking: number
  totalPlayersInCluster: number
  guildRanking: number
  totalPlayersInGuild: number
  playerKey: string
  reliabilityData?: PlayerReliability | null
}

export interface TokenAvailability {
  tokens: number
  bombs: number
  dataSource: string
  burnedTokens?: number | null
  timeOverCapSeconds?: number | null
  tokensUsed?: number | null
  /** Per-player spendable cap from the token RPC. */
  maxPossible?: number | null
  /** Null at the cap or without a clock. */
  nextTokenSeconds?: number | null
  /** Seconds left on the 18h cooldown; null while the bomb is in hand or without a clock. */
  nextBombSeconds?: number | null
  /** Fetch time, so live tiles age `nextTokenSeconds` instead of replaying a stale countdown. */
  fetchedAtMs?: number
}

export interface BossAssignmentDetails {
  primary?: { name: string; set: number; rarity: string }
  secondary?: { name: string; set: number; rarity: string }
}

export interface PlayerStatsSelection {
  player: string
  season: string
  guild: string
}

export interface PlayerStatsContext {
  resolvedGuild: string
  resolvedGuildName: string
  resolvedClusterCode: string | null
  mapping: PlayerMapping | null
  assignments: BossAssignmentDetails | null
  status: LoadingStatus
  tokens?: TokenAvailability | null
}

export type LoadingStatus = 'idle' | 'loading' | 'success' | 'error'

export interface PlayerStatsState {
  status: LoadingStatus
  selection: PlayerStatsSelection
  searchTerm: string
  availablePlayers: string[]
  playerGuildMap: Record<string, string>
  context: PlayerStatsContext | null
  stats: PlayerStats | null
  tokens: TokenAvailability | null
  supabaseError: Error | null
  errorMessage: string | null
  playerMapping: PlayerMapping | null
  rankingsVersion: number
  lastUpdatedKey: string
}

export type PlayerStatsAction =
  | { type: 'SET_SEARCH_TERM'; payload: string }
  | {
      type: 'SET_AVAILABLE_PLAYERS'
      payload: { players: string[]; guildMap: Record<string, string> }
    }
  | { type: 'SELECT_PLAYER'; payload: { player: string } }
  | { type: 'SET_CONTEXT'; payload: PlayerStatsContext }
  | { type: 'SET_STATUS'; payload: LoadingStatus }
  | { type: 'SET_STATS'; payload: { stats: PlayerStats | null; key: string } }
  | { type: 'MERGE_STATS'; payload: { stats: PlayerStats; key: string } }
  | { type: 'SET_TOKENS'; payload: TokenAvailability | null }
  | { type: 'SET_SUPABASE_ERROR'; payload: Error | null }
  | { type: 'SET_ERROR_MESSAGE'; payload: string | null }
  | { type: 'SET_MAPPING'; payload: PlayerMapping | null }
  | { type: 'INCREMENT_RANKINGS' }
  | { type: 'RESET_FOR_PLAYER'; payload: { player: string } }
  | { type: 'RESET_FOR_SEARCH'; payload: { player: string } }
  | { type: 'SET_SELECTION'; payload: { guild?: string; season?: string } }

export interface PlayerStatsControllerOptions {
  selectedGuild: string
  selectedSeason: string
  userRole?: PlayerRole | string
  userDisplayName?: string
  clusterCode?: string
  isRestricted?: boolean
  initialSearch?: string
}

export type BattleRow = {
  remainingHp: number
  maxHp: number
  damageDealt: number
  damageType: 'Battle' | 'Bomb'
}

export type PlayerPerformanceRpcResult = {
  cluster_rank?: number
  total_players_in_cluster?: number
  vs_cluster_pct?: number
  vs_guild_pct?: number
}

export interface PlayerStatsFetchResult {
  playerKey: string
  resolvedGuild: string
  resolvedGuildName: string
  resolvedClusterCode: string | null
  mapping: PlayerMapping | null
  assignments: BossAssignmentDetails | null
  historicalPerformance: Record<string, HistoricalPerformanceEntry>
  historicalTokens: Record<string, number>
  historicalTotalDamage: Record<string, number>
  historicalReliability: Record<string, number>
  clusterRanking: number
  totalPlayersInCluster: number
  guildRanking: number
  totalPlayersInGuild: number
  reliabilityData: PlayerReliability | null
  tokenAvailability: TokenAvailability | null
}

export interface BossRanking {
  boss_name: string
  encounter_id: number
  player_rank: number
  total_players: number
}

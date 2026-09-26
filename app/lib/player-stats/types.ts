import type { Database } from '@tacticus/app-core/database.generated'

export interface BossDetail {
  bossName: string
  vsGuild: number
  vsCluster: number
  battles: number
  playerAvgDamage?: number
  /** Raw totals allow recomputation under a different sweep threshold. */
  nonSweepDamage?: number
  nonSweepBattleCount?: number
  sweepDamages?: number[]
}

export interface HistoricalPerformanceEntry {
  vsGuild: number
  vsCluster: number
  /** `vsGuild: 0` alone is ambiguous: exact match or the no-comparison fallback. */
  hasGuildComparison?: boolean
  clusterRank?: number
  guildRank?: number
  guild?: string
  bossDetails?: BossDetail[]
  totalPlayersInCluster?: number
  totalPlayersInGuild?: number
}

export interface HistoricalDataSets {
  performance: Record<string, HistoricalPerformanceEntry>
  tokens: Record<string, number>
  totalDamage: Record<string, number>
  reliability: Record<string, number>
}

export type HistoricalDataRow = Partial<
  Pick<
    Database['public']['Tables']['EOT_GR_data']['Row'],
    | 'Season'
    | 'displayName'
    | 'Name'
    | 'damageDealt'
    | 'remainingHp'
    | 'maxHp'
    | 'set'
    | 'tier'
    | 'rarity'
    | 'encounterId'
    | 'userId'
    | 'Guild'
    | 'damageType'
  >
>

/** All numeric columns are NULL on the "< 2 battles" branch; `Number(null)` would render a fake 0. */
export type ReliabilityRpcResult = {
  reliability_score?: number | null
  performance_stddev?: number | null
  coefficient_of_variation?: number | null
  avg_performance?: number | null
  performance_range_min?: number | null
  performance_range_max?: number | null
  consistency_rating?: string | null
  battles_analyzed?: number | null
  season_used?: string | null
}

export interface GuildAvgRpcRow {
  season: string
  boss_key: string
  avg_damage: number
  total_damage: number
  battle_count: number
}

export interface GuildScoreRpcRow {
  season: string
  user_id: string
  weighted_vs_guild: number
  battle_count: number
}

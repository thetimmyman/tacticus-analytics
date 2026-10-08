import type { Rarity } from '@/app/lib/config'
import type { TokenUsageRpcRowRaw } from '@/app/lib/types/token-usage-rpc'
import type {
  SeasonForecastEnvelope,
  SeasonForecastPlayerRow
} from '@/app/lib/season-forecast/forecast-service'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'

export type DataSource = 'live' | 'calculated' | 'cached' | 'default'

export interface PlayerTokens {
  userId: string
  displayName: string
  totalTokens: number
  bossTokens: number
  primeTokens: number
  tokensAvailable?: number
  tokenNextSeconds?: number | null
  bombsAvailable?: number
  bombNextSeconds?: number | null
  burnedTokens?: number | null
  burnedTokensUsage?: number | null
  burnedDelta?: number | null
  timeOverCapSeconds?: number | null
  /** floor(timeOverCapSeconds / 43200); unrecoverable, distinct from burnedTokens. */
  overcappedTokens?: number
  avgTokensPerLoop: number
  efficiency: number
  historicalAvg?: number
  tokensByRarity: TokensByRarity
  dataSource?: DataSource
  /** Per-player season-end projection; null when the player has no envelope row. */
  projection?: SeasonForecastPlayerRow | null
}

export interface TokensByRarity {
  common: number
  uncommon: number
  rare: number
  epic: number
  legendary: number
  mythic: number
}

export interface BossTokenData {
  bossName: string
  tokenCount: number
  percentage: number
  color: string
}

export interface TotalStats {
  totalTokens: number
  maxTokens: number
  averageUsage: number
  tokensAvailableAvg: number
  bombsAvailableCount: number
}

export type SortOption =
  'total' | 'efficiency' | 'avgPerLoop' | 'historical' | 'projectedBySeasonEnd'

export const DEFAULT_RARITIES: Rarity[] = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic'
]

/** @deprecated Use TokenUsageRpcRowRaw from @/app/lib/types/token-usage-rpc for new code */
export type RpcTokenUsageRow = TokenUsageRpcRowRaw

export interface TokenAvailabilityRow {
  player_id?: string | null
  display_name: string | null
  tokens_available: number | null
  token_next_in_seconds: number | null
  bombs_available?: number | null
  bombs_available_live?: number | null
  bomb_next_in_seconds: number | null
  burned_tokens?: number | null
  time_over_cap_seconds?: number | null
  data_source?: string | null
}

export interface GuildTokenAvailabilityRow extends TokenAvailabilityRow {
  player_id: string
  display_name: string
  tokens_available: number
  token_next_in_seconds: number | null
  bombs_available: number
  bomb_next_in_seconds: number | null
  api_key_is_valid: boolean
  data_source: string
  token_cooldown?: string | null
  bomb_cooldown?: string | null
  last_sync_at?: string | null
  time_to_next_token?: string | null
  last_battle_time?: string | null
  battles_with_damage?: number
}

export interface TokenAvailabilityData {
  playerId?: string | null
  displayName?: string
  // Undefined without a cached value so the chart merge can fall through with `??`.
  tokensAvailable?: number
  tokenNextSeconds: number | null
  bombsAvailable?: number
  bombNextSeconds: number | null
  burnedTokens?: number | null
  timeOverCapSeconds?: number | null
  dataSource?: DataSource
}

export interface RpcTokenData {
  playerId?: string | null
  displayName?: string
  tokens: number
  bossTokens: number
  primeTokens: number
  maxPossible: number
  tokensAvailable?: number
  tokenNextSeconds?: number | null
  bombsAvailable?: number
  bombNextSeconds?: number | null
  burnedTokens?: number | null
  timeOverCapSeconds?: number | null
}

export interface PlayerStats {
  displayName: string
  tokens: number
  bossTokens: number
  primeTokens: number
  totalDamage: number
  loops: Set<number>
  tokensByRarity: TokensByRarity
}

export interface BattleDataRow {
  userId: string
  displayName: string
  Season: string
  damageType: string
  rarity: string
  damageDealt: number
  Name: string
  encounterId: number
  loopIndex: number
}

export interface TokenUsageResult {
  computedAt?: string | null
  players: PlayerTokens[]
  bossDistribution: BossTokenData[]
  totalStats: TotalStats
  availabilityRows: GuildTokenAvailabilityRow[]
  /** Null when not requested, failed, or no per-player rows matched. */
  forecast: SeasonForecastEnvelope | null
  /** Pace figures supersede the envelope's; null when not requested or failed. */
  outlook: SeasonOutlookProjection | null
}

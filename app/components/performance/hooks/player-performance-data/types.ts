export interface PlayerPerformancePageProps {
  selectedGuild: string
  selectedSeason: string
  userGuild?: string
  userRole?: string
}

export interface PlayerMappingStatusRow {
  player_id?: string | null
  display_name?: string | null
  is_current?: boolean | null
  is_active?: boolean | null
}

export interface TokenUsageBurnRpcRow {
  player_id?: string | null
  display_name?: string | null
  displayName?: string | null
  tokens_used?: number | null
  tokens_available?: number | null
  token_next_in_seconds?: number | null
  burned_tokens?: number | null
  time_over_cap_seconds?: number | null
}

export interface LiveAvailabilityRow {
  player_id?: string | null
  display_name?: string | null
  tokens_used?: number | null
  tokens_available?: number | null
  token_next_in_seconds?: number | null
}

export interface BurnStatRow {
  playerId?: string
  displayName: string
  burnedTokens: number
  overcappedTokens: number
  timeOverCapSeconds: number
}

export interface PerformanceBurnSummary {
  hasData: boolean
  totalBurnedTokens: number
  totalOvercappedTokens: number
  playersWithBurnedTokens: number
  totalTimeOverCapSeconds: number
  topBurnedPlayers: BurnStatRow[]
}

export interface TargetLoopRange {
  start: number
  end: number
}

export const EMPTY_BURN_SUMMARY: PerformanceBurnSummary = {
  hasData: false,
  totalBurnedTokens: 0,
  totalOvercappedTokens: 0,
  playersWithBurnedTokens: 0,
  totalTimeOverCapSeconds: 0,
  topBurnedPlayers: []
}

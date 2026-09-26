// Raw row. player_id/user_id, display_name/displayName and tokens_used/token_count
// are the same value under names from different schema eras.
export interface TokenUsageRpcRowRaw {
  player_id?: string | null
  user_id?: string | null

  display_name?: string | null
  displayName?: string | null

  tokens_used?: number | null
  token_count?: number | null

  max_possible?: number | null
  tokens_below_offender?: boolean | null
  tokens_below_abuser?: boolean | null
  boss_tokens?: number | null
  prime_tokens?: number | null
  bombs_used?: number | null
  bombs_available?: number | null
  bombs_available_live?: number | null
  bomb_next_in_seconds?: number | null
  tokens_available?: number | null
  token_next_in_seconds?: number | null
  burned_tokens?: number | null
  time_over_cap_seconds?: number | null
}

export interface TokenUsageRowNormalized {
  player_id: string
  display_name: string
  tokens_used: number
  max_possible: number
  tokens_below_offender: boolean
  tokens_below_abuser: boolean
  boss_tokens: number
  prime_tokens: number
  bombs_used: number
  bombs_available: number
  burned_tokens: number
  time_over_cap_seconds: number
}

export function normalizeTokenUsageRow(
  row: TokenUsageRpcRowRaw
): TokenUsageRowNormalized {
  return {
    player_id: row.player_id ?? row.user_id ?? '',
    display_name: row.display_name ?? row.displayName ?? '',
    tokens_used: Number(row.tokens_used ?? row.token_count ?? 0),
    max_possible: Number(row.max_possible ?? 0),
    tokens_below_offender: Boolean(row.tokens_below_offender),
    tokens_below_abuser: Boolean(row.tokens_below_abuser),
    boss_tokens: Number(row.boss_tokens ?? 0),
    prime_tokens: Number(row.prime_tokens ?? 0),
    bombs_used: Number(row.bombs_used ?? 0),
    bombs_available: Number(row.bombs_available ?? 0),
    burned_tokens: Number(row.burned_tokens ?? 0),
    time_over_cap_seconds: Number(row.time_over_cap_seconds ?? 0)
  }
}

import type { EOTGRData } from '@tacticus/app-core/types'

export interface PlayerTokenStatus {
  display_name: string
  player_id: string
  discord_user_id: string | null
  last_sync_tokens: number | null
  last_sync_bombs: number | null
  last_sync_at: string | null
  next_token_seconds: number | null
  next_bomb_seconds: number | null
  api_key_is_valid: boolean | null
  tokens_available: number
  bombs_available: number
  token_cooldown: string | null
  bomb_cooldown: string | null
  data_source: 'live' | 'calculated'
  last_battle_time: string | null
  battles_with_damage: number
  burned_tokens?: number | null
  time_over_cap_seconds?: number | null
  tokens_used: number
  max_possible: number
  token_next_in_seconds: number | null
}

export interface GuildTokenDebugInfo {
  total_battles: number
  current_season_battles: number
  previous_season_battles: number
  seasons_checked: string[]
  live_api_fetched?: number
  live_api_eligible?: number
}

export type RawMemberRow = {
  player_id: string
  display_name: string
  user_id: string | null
  discord_user_id: string | null
  last_sync_tokens: number | null
  last_sync_bombs: number | null
  last_sync_at: string | null
  next_token_seconds: number | null
  next_bomb_seconds: number | null
  api_key_is_valid: boolean | null
  tacticus_api_key_encrypted: string | null
}

export type BattleQueryRow = Pick<
  EOTGRData,
  'userId' | 'displayName' | 'damageType' | 'startedOn' | 'damageDealt'
>

export type BattleRow = Omit<BattleQueryRow, 'userId' | 'startedOn'> & {
  userId: string
  startedOn: string
}

export interface LiveTokenData {
  tokensAvailable: number
  bombsAvailable: number
  tokenNextSeconds: number | null
  bombNextSeconds: number | null
}

export type PlayerTokenSnapshotRow = Pick<
  RawMemberRow,
  | 'player_id'
  | 'display_name'
  | 'last_sync_tokens'
  | 'last_sync_bombs'
  | 'next_token_seconds'
  | 'next_bomb_seconds'
  | 'api_key_is_valid'
>

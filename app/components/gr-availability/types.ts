import { TACTICUS_API } from '@tacticus/app-core/app-config'
import type { GuildTokenAvailabilityRow } from '@/app/components/token-usage/types'

export type TokenState = 'empty' | 'regenerating' | 'capped'
export type DataSource = 'live' | 'calculated' | 'default'

export const TACTICUS_SITE = `${TACTICUS_API.ORIGIN}/`

export interface PlayerData {
  player_id: string
  display_name: string
  tokens_available: number
  bombs_available: number
  api_key_is_valid: boolean
  data_source: string
  token_cooldown?: string | null
  bomb_cooldown?: string | null
  time_to_next_token?: string | null
  last_sync_at?: string | null
  last_battle_time?: string | null
  battles_with_damage?: number
}

export interface GuildTokensResponse {
  players: PlayerData[]
  summary?: Record<string, number>
}

export interface PlayerAvailability {
  player_id: string
  display_name: string
  tokens_available: number
  bombs_available: number
  token_state: TokenState
  data_source: DataSource
  has_api_key: boolean
  token_cooldown: string | null
  bomb_cooldown: string | null
  last_sync_at: string | null
  time_to_next_token?: string | null
  last_battle_time?: string | null
  battles_with_damage: number
}

export interface SeededAvailability {
  key: string
  players: PlayerAvailability[]
  playersWithApiKeys: Set<string>
}

export type SaveStatusType = 'success' | 'error' | 'info'
export type SyncStatusType = SaveStatusType | 'warning'
export type ExportStatusType = 'success' | 'error'

export interface StatusState<T extends string> {
  type: T | null
  message: string
}

export interface GRAvailabilityProps {
  guildCode: string
  season: string
  initialTokenRows?: GuildTokenAvailabilityRow[]
}

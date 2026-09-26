import type {
  Database,
  PlayerRole,
  PlayerMapping
} from '@tacticus/app-core/types'

export type GuildMemberBrowserSafeRpcRow =
  Database['public']['Functions']['get_guild_members_browser_safe']['Returns'][number]

export type BrowserGuildMemberRow = Omit<
  GuildMemberBrowserSafeRpcRow,
  'has_api_key'
> & {
  hasApiKey: boolean
}

export function toBrowserGuildMemberRow(
  row: GuildMemberBrowserSafeRpcRow
): BrowserGuildMemberRow {
  const { has_api_key: hasApiKey, ...member } = row
  return { ...member, hasApiKey: hasApiKey === true }
}

export type RoleFilter = 'all' | PlayerRole
export type SortColumn =
  | 'player'
  | 'role'
  | 'status'
  | 'token'
  | 'performance'
  | 'assignment'
  | 'notes'
export type MemberActionType =
  | 'apiKey'
  | 'assignBosses'
  | 'notes'
  | 'bossPreferences'
  | 'metaTeams'
  | 'heraldRoles'
  | 'discordHandle'
  | 'viewRoster'
  | 'generateInviteCode'
  | 'adminUnlink'

export type ExtendedMember = PlayerMapping & {
  /** Derived server-side; stored key ciphertext must never reach the browser. */
  hasApiKey?: boolean
  primary_team?: string | null
  secondary_team?: string | null
  tertiary_team?: string | null
  primary_boss?: string | null
  secondary_boss?: string | null
  assignment_notes?: string | null
  boss_preferences?: Record<string, 'preferred' | 'avoid' | 'neutral'> | null
  officer_notes?: string | null
  player_notes?: string | null
  guild_name?: string | null
  has_battle_data?: boolean
  last_login_at?: string | null
  last_battle_time?: string | null
  last_bomb_time?: string | null
  timezone?: string | null
}

export interface TokenUsageData {
  player_id?: string | null
  user_id?: string | null
  tokens_used: number
  max_possible: number
  bombs_used?: number
  bombs_available?: number
  tokens_available?: number
  token_next_in_seconds?: number | null
  bombs_available_live?: number
  bomb_next_in_seconds?: number | null
}

export type TokenUsageResponse = TokenUsageData & {
  display_name: string
}

export interface BossPerformanceData {
  boss_name: string
  display_key: string
  encounter_id: number
  set_num: number
  tier: number
  rarity: string
  player_vs_guild_avg: number
  player_vs_cluster_avg: number
  preference: string
}

export interface Boss {
  boss_type: string
  display_name: string
  encounter_index: number
  boss_name: string
}

export interface RosterUnit {
  id: string
  name: string
  faction: string
  grandAlliance: string
  rank: number
  xpLevel: number
}

export interface MetaTeam {
  team_name: string
  display_name: string | null
}

export interface TokenUsageSummary {
  used: number
  max: number | null
  available: number
  nextSeconds: number | null
}

export interface BombStatus {
  available: boolean
  used: number
  nextSeconds: number | null
}

export { BOSS_DISPLAY_NAMES, TOKEN_CAP } from '@tacticus/app-core/common.types'

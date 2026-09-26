export interface DatabaseRecord {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | Date
    | DatabaseRecord
    | DatabaseRecord[]
}

export interface ChartDataPoint {
  subject?: string
  label?: string
  value: number
  [key: string]: string | number | boolean | undefined
}

export interface RadarDataPoint {
  subject: string
  value: number
  fullMark: number
  [key: string]: string | number | undefined
}

export interface FormData {
  [key: string]:
    string | number | boolean | File | FormData | FormData[] | undefined
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string | { message: string; code?: string }
  success: boolean
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface PlayerMapping {
  id: string
  user_id: string
  player_id: string
  display_name: string
  guild_code: string
  role: 'member' | 'officer' | 'leader'
  theme_preference?: string
  timezone?: string
  boss_preferences?: string
  primary_boss?: string
  secondary_boss?: string
  assignment_notes?: string
  is_current: boolean
  is_active: boolean
  has_duplicate_name: boolean
  original_display_name?: string
  auto_generated: boolean
  created_at: string
  updated_at: string
  tacticus_api_key_encrypted?: string
  api_key_added_at?: string
  api_key_last_verified?: string
  api_key_is_valid?: boolean
  cluster_code?: string
  cluster_id?: string
  is_app_admin?: boolean
}

export interface GuildConfig {
  guild_code: string
  display_name: string
  enabled: boolean
  api_key?: string
  token_offender_threshold?: number
  token_abuser_threshold?: number
  tagline?: string
  description?: string
  logo_url?: string
  GR_Ranking?: number
  GW_Ranking?: number
  cluster_code?: string
  cluster_id?: string
  guild_id?: string
  user_id?: string
  session_id?: string
  API_Owner?: string
  api_key_is_valid?: boolean
  api_key_last_validated?: string
}

export interface Cluster {
  id: string
  cluster_code: string
  display_name: string
  description?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface HeroMapping {
  unit_id: string
  display_name: string
  web_icon_url?: string
  category: 'Hero' | 'MOW' // Machine of War
}

export interface TeamComposition {
  heroes: string[]
  machineOfWar?: string
  [key: string]: string | string[] | undefined
}

export interface CalculationResult {
  value: number
  formatted: string
  unit?: string
  description?: string
}

export interface CalculationMetric {
  id: string
  name: string
  category: string
  value: number | string
  formatted: string
  dependencies?: string[]
}

export interface ThemeColors {
  primary: string
  secondary: string
  accent: string
  background: {
    from: string
    via: string
    to: string
  }
  cardBg: string
  cardBorder: string
  text: {
    primary: string
    secondary: string
    accent: string
  }
}

export interface DiscordWebhookPayload {
  content?: string
  embeds?: Array<{
    title?: string
    description?: string
    color?: number
    fields?: Array<{
      name: string
      value: string
      inline?: boolean
    }>
    footer?: {
      text: string
      icon_url?: string
    }
    timestamp?: string
  }>
}

export function isApiError(
  error: unknown
): error is { message: string; code?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  )
}

export function isPlayerMapping(data: unknown): data is PlayerMapping {
  return (
    typeof data === 'object' &&
    data !== null &&
    'user_id' in data &&
    'guild_code' in data &&
    'role' in data
  )
}

export const BOSS_DISPLAY_NAMES: Record<string, string> = {
  AvatarOfKhaine: 'Avatar of Khaine',
  Belisarius: 'Belisarius Cawl',
  Boss2: 'Boss 2',
  Ghazghkull: 'Ghazghkull',
  HiveTyrantGorgon: 'Hive Tyrant (Gorgon)',
  HiveTyrantKronos: 'Hive Tyrant (Kronos)',
  HiveTyrantLeviathan: 'Hive Tyrant (Leviathan)',
  Magnus: 'Magnus',
  Mortarion: 'Mortarion',
  RogalDorn: 'Rogal Dorn',
  ScreamerKiller: 'Screamer Killer',
  SilentKing: 'Silent King',
  TervigonGorgon: 'Tervigon (Gorgon)',
  TervigonKronos: 'Tervigon (Kronos)',
  TervigonLeviathan: 'Tervigon (Leviathan)'
}

export const TOKEN_CAP = 3

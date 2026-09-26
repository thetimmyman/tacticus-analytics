import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.generated'
import {
  BOSS_PREFERENCES,
  DAMAGE_TYPES,
  ENCOUNTER_TYPES,
  PLAYER_ROLES,
  RARITY_LEVELS,
  TOKEN_STATES
} from './domain-constants'

export type { Database, Json } from './database.generated'

export type TypedSupabaseClient = SupabaseClient<Database>

export type EOTGRData = Database['public']['Tables']['EOT_GR_data']['Row']
export type PlayerMapping =
  Database['public']['Tables']['player_mapping']['Row']
export type GuildConfig = Database['public']['Tables']['guild_config']['Row']
export type HeroMapping = Database['public']['Tables']['hero_mappings']['Row']
export type BombTracking = Database['public']['Tables']['bomb_tracking']['Row']
export type ApiKeyCoverage =
  Database['public']['Views']['api_key_coverage']['Row']

export type GuildBossSeasonRotation =
  Database['public']['Tables']['guild_boss_season_rotation']['Row']
export type GuildBossSeasonRotationInsert =
  Database['public']['Tables']['guild_boss_season_rotation']['Insert']
export type CurrentGuildBossSeasonRotation =
  Database['public']['Views']['current_guild_boss_season_rotation']['Row']

export type DiscordServerGuild =
  Database['public']['Tables']['discord_server_guilds']['Row']
export type DiscordChannelGuild =
  Database['public']['Tables']['discord_channel_guilds']['Row']
export type DiscordInviteCode =
  Database['public']['Tables']['discord_invite_codes']['Row']
export type DiscordUserGuildDefault =
  Database['public']['Tables']['discord_user_guild_defaults']['Row']
export type DiscordTokenReminder =
  Database['public']['Tables']['discord_token_reminders']['Row']

export type PlayerRole = Database['public']['Enums']['app_role']
export type UserRole = PlayerRole | 'applicant' | 'admin' | 'onboarding' | null
export type DamageType = (typeof DAMAGE_TYPES)[number]

export type {
  AdminActionResult,
  LeaderboardEntry,
  WebhookConfig,
  GuildSnapshot
} from './database-extensions'

export type {
  CalculationContext,
  CalculationDefinition,
  CalculationDependencies,
  CalculationResult
} from './calculations.types'

export {
  BOSS_PREFERENCES,
  DAMAGE_TYPES,
  ENCOUNTER_TYPES,
  PLAYER_ROLES,
  RARITY_LEVELS,
  TOKEN_STATES
}

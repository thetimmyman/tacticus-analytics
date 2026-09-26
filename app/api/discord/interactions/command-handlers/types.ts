import type {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandInteractionDataOption,
  APIChatInputApplicationCommandInteraction,
  APIInteractionResponseCallbackData
} from 'discord-api-types/v10'
import type {
  Database,
  DiscordInviteCode,
  TypedSupabaseClient
} from '@tacticus/app-core/types'

export type Supabase = TypedSupabaseClient
export type CommandInteraction = APIChatInputApplicationCommandInteraction
export type CommandResponse = APIInteractionResponseCallbackData
export type AutocompleteInteraction =
  APIApplicationCommandAutocompleteInteraction
export type CommandOption = APIApplicationCommandInteractionDataOption

export type CommandHandler = (
  supabase: Supabase,
  interaction: CommandInteraction
) => Promise<CommandResponse>

export type AutocompleteHandler = (
  supabase: Supabase,
  interaction: AutocompleteInteraction
) => Promise<CommandResponse>

export type DiscordTheme = {
  color: number
  accentEmoji: string
}

export type LinkedGuild = {
  guildCode: string
  guildTag: string | null
  displayName: string | null
  clusterCode: string | null
}

export type GuildResolutionSuccess = {
  ok: true
  guild: LinkedGuild
  allGuilds: LinkedGuild[]
  source: 'option' | 'channel' | 'user' | 'default'
}

export type GuildResolutionFailure = {
  ok: false
  response: CommandResponse
}

export type GuildResolutionResult =
  GuildResolutionSuccess | GuildResolutionFailure

export type TokenPlayerData = {
  displayName: string
  discordUserId: string | null
  tokensAvailable: number
  bombsAvailable: number
  tokenCooldown: string | null
  bombCooldown: string | null
}

export type FetchGuildTokensSuccess = {
  ok: true
  players: TokenPlayerData[]
}

export type FetchGuildTokensFailure = {
  ok: false
  message: string
}

export type FetchGuildTokensResult =
  FetchGuildTokensSuccess | FetchGuildTokensFailure

export type ActiveRosterPlayer = {
  player_id: string
  display_name: string
  guild_code: string
  is_current: boolean
  discord_user_id?: string | null
}

export type ActiveRoster = Map<string, ActiveRosterPlayer[]>

export type ActiveRosterSuccess = {
  ok: true
  roster: ActiveRoster
}

export type ActiveRosterFailure = {
  ok: false
  message: string
}

export type ActiveRosterResult = ActiveRosterSuccess | ActiveRosterFailure

export { type Database, type DiscordInviteCode }

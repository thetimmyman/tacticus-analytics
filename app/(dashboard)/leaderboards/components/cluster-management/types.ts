export interface Guild {
  guild_code: string
  guild_tag: string | null
  display_name: string | null
  has_api_key: boolean
  api_key?: string
  API_Owner?: string | null
  // Display name, else masked email / raw label; never an unmasked email.
  api_owner_display?: string | null
  api_key_is_valid?: boolean | null
  api_key_last_validated?: string | null
  enabled: boolean
  GR_Ranking: number | null
  GW_Ranking: number | null
  token_offender_threshold: number | null
  token_abuser_threshold: number | null
  cluster_code: string | null
}

export interface GuildDiscordLink {
  guildCode: string
  displayName: string | null
  discordLink: {
    discordGuildId: string
    invitedWithCode: string | null
    linkedAt: string | null
    linkedByUserId: string | null
  } | null
  invites: ClusterInvite[]
}

export interface ClusterInvite {
  id: number
  inviteCode: string
  createdAt: string | null
  expiresAt: string | null
  maxUses: number
  currentUses: number
  isActive: boolean
}

export interface RawInvite {
  id: number
  invite_code?: string
  inviteCode?: string
  created_at?: string | null
  createdAt?: string | null
  expires_at?: string | null
  expiresAt?: string | null
  max_uses?: number
  maxUses?: number
  current_uses?: number
  currentUses?: number
  is_active?: boolean
  isActive?: boolean
}

export interface RawDiscordLink {
  discord_guild_id: string
  invited_with_code: string | null
  linked_at: string | null
  linked_by_user_id: string | null
}

export interface RawGuildLink {
  guildCode: string
  displayName: string | null
  discordLink?: RawDiscordLink | null
  invites?: RawInvite[]
}

export interface DiscordLinksResponse {
  success?: boolean
  error?: string
  data?: {
    guilds?: RawGuildLink[]
    clusterInvites?: RawInvite[]
  }
}

export interface ClusterConfig {
  minimum_player_level: number
  rejection_message: string
}

export interface ClusterManagementProps {
  season: string
  isNonEot?: boolean
  userGuildCode?: string
  userRole?: string
  clusterCode?: string
  initialTab?: string
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  minimum_player_level: 55,
  rejection_message:
    'We are an end-game cluster with all guilds in the top 30 rankings, we require players to be at least level {level}. Please come join our discord for conversation on how to increase your player level, check out the IVS cluster that has starter friendly guilds available, and check us out later.'
}

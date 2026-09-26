import type { Dispatch, SetStateAction } from 'react'

export type ClusterSetupMethod = 'direct' | 'invite_code'

export interface FoundingGuild {
  guildCode: string
  displayName: string
  leaderEmail: string
  apiKey?: string
}

export type FoundingGuildDraft = Omit<FoundingGuild, 'apiKey'> & {
  apiKey: string
}

export interface ClusterData {
  clusterCode: string // e.g., "NOVA", "ALLY" - serves as ID and abbreviation
  displayName: string // e.g., "Example Alliance" - human-readable name
  tagline: string
  description: string
  timezone: string
  primaryLanguage: string

  primaryColor: string
  secondaryColor: string
  accentColor: string
  logoUrl: string
  bannerUrl: string

  discordServerId: string
  discordInviteUrl: string
  discordWebhookUrl: string

  maxGuilds: number
  tokenOffenderThreshold: number
  tokenAbuserThreshold: number

  setupMethod: ClusterSetupMethod
  generateInviteCode: boolean

  // Direct setup only.
  foundingGuilds: FoundingGuild[]
}

export interface StepProps {
  data: ClusterData
  setData: Dispatch<SetStateAction<ClusterData>>
  errors?: Record<string, string>
}

export interface BrandingStepProps extends StepProps {
  skipBranding: boolean
  setSkipBranding: Dispatch<SetStateAction<boolean>>
}

export interface DiscordStepProps extends StepProps {
  skipDiscord: boolean
  setSkipDiscord: Dispatch<SetStateAction<boolean>>
}

export const TIMEZONES = [
  'UTC',
  'UTC-1',
  'UTC-2',
  'UTC-3',
  'UTC-4',
  'UTC-5',
  'UTC-6',
  'UTC-7',
  'UTC-8',
  'UTC-9',
  'UTC-10',
  'UTC-11',
  'UTC+1',
  'UTC+2',
  'UTC+3',
  'UTC+4',
  'UTC+5',
  'UTC+6',
  'UTC+7',
  'UTC+8',
  'UTC+9',
  'UTC+10',
  'UTC+11',
  'UTC+12'
]

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' }
]

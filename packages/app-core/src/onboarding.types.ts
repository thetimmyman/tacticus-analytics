import type { Database } from './database.generated'

export type OnboardingGuildStatus =
  'not_started' | 'pending' | 'in_progress' | 'complete' | 'failed'

export type OnboardingSyncStatus =
  'not_required' | 'pending' | 'syncing' | 'complete' | 'failed'

export type OnboardingProfileStatus =
  'not_started' | 'pending' | 'complete' | 'failed'

export type OnboardingRoleIntent = 'member' | 'leader'

export type GuildMode = 'existing_guild' | 'new_guild'

export type OnboardingJobType = 'guild_initial_sync'

export type OnboardingJobStatus =
  'queued' | 'processing' | 'completed' | 'failed'

type OnboardingProgressRow =
  Database['public']['Tables']['onboarding_progress']['Row']

type NarrowedOnboardingKeys =
  | 'guild_mode'
  | 'role_intent'
  | 'guild_status'
  | 'sync_status'
  | 'profile_status'
  | 'guild_can_retry'
  | 'sync_can_retry'
  | 'profile_can_retry'
  | 'sync_progress'
  | 'sync_records_synced'
  | 'created_at'
  | 'updated_at'

/** Onboarding row with CHECK and DEFAULT columns narrowed to the runtime contract. */
export type OnboardingProgress = Omit<
  OnboardingProgressRow,
  NarrowedOnboardingKeys
> & {
  guild_mode: GuildMode
  role_intent: OnboardingRoleIntent
  guild_status: OnboardingGuildStatus
  sync_status: OnboardingSyncStatus
  profile_status: OnboardingProfileStatus
  guild_can_retry: boolean
  sync_can_retry: boolean
  profile_can_retry: boolean
  sync_progress: number
  sync_records_synced: number
  created_at: string
  updated_at: string
}

export interface GuildSetupData {
  guildCode: string
  guildName: string
  apiKey: string
  tacticusUserId: string
  clusterCode?: string
  discordHandle?: string
  plannerUrl?: string
}

export interface DataSyncResult {
  success: boolean
  recordsSynced?: number
  error?: string
}

export interface ProfileClaimData {
  tacticusUserId: string
  guildCode: string
}

export interface OnboardingJob {
  id: string
  user_id: string | null
  guild_code: string | null
  cluster_code: string | null
  job_type: OnboardingJobType
  status: OnboardingJobStatus
  attempts: number
  max_attempts: number
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error_message: string | null
  last_error_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ClusterSummary {
  id: string
  cluster_code: string
  display_name: string
  description: string | null
  onboarding_completed: boolean | null
}

export interface ClusterGuildSummary {
  guild_code: string
  display_name: string | null
  enabled: boolean | null
  onboarding_completed: boolean | null
  job: OnboardingJob | null
}

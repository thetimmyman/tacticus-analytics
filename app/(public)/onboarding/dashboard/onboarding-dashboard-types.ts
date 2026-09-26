import type {
  ClusterGuildSummary,
  ClusterSummary,
  OnboardingJob,
  OnboardingProgress
} from '@tacticus/app-core/onboarding.types'

export interface SyncStatusMeta {
  guild_code: string
  status: string | null
  queue_status: string | null
  records_synced: number | null
  last_sync: string | null
  full_sync_success: boolean | null
  updated_at: string | null
}

export type PendingAction =
  | null
  | 'mode'
  | 'existing'
  | 'new'
  | 'sync'
  | 'refresh'
  | 'cluster_create'
  | 'cluster_guild'
  | 'cluster_requeue'

export interface OnboardingDashboardProps {
  user: {
    id: string
    email: string
    displayName: string | null
  }
  initialProgress: OnboardingProgress
  initialSyncStatus: SyncStatusMeta | null
  initialJob: OnboardingJob | null
  initialCluster: ClusterSummary | null
  initialClusterGuilds: ClusterGuildSummary[]
  /** `null` = not known yet for the current guild. */
  guildAwaitingFirstClaim?: boolean | null
}

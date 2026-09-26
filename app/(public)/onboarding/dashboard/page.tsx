import { redirect } from 'next/navigation'
import { serviceDb } from '@/app/lib/db'
import { getOrCreateOnboardingProgress } from '@/app/lib/onboarding/progress'
import { fetchLatestJobForGuild } from '@/app/lib/onboarding/jobs'
import { resolveOnboardingMembershipState } from '@/app/lib/onboarding/membership-state'
import { isGuildAwaitingFirstClaim } from '@/app/lib/onboarding/first-claim'
import type {
  OnboardingProgress,
  OnboardingJob,
  ClusterSummary,
  ClusterGuildSummary
} from '@tacticus/app-core/onboarding.types'
import OnboardingDashboardClient from '@/app/(public)/onboarding/dashboard/OnboardingDashboardClient'
import { createComponentLogger } from '@/app/lib/logging/client'
import { createPageMetadata } from '@/app/lib/metadata'
import { requireAuthAllowInactive } from '@/app/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = createPageMetadata({
  title: 'Onboarding Dashboard',
  description:
    'Track onboarding progress, guild setup, data sync status, and profile completion for new Tacticus Analytics users.',
  path: '/onboarding/dashboard'
})

const logger = createComponentLogger('onboarding.dashboard.page')

interface OnboardingProfile {
  role: string | null
  onboarding_complete: boolean | null
  onboarding_role_intent: string | null
  guild_code: string | null
  cluster_code: string | null
  display_name: string | null
}

type SyncStatusMeta = {
  guild_code: string
  status: string | null
  queue_status: string | null
  records_synced: number | null
  last_sync: string | null
  full_sync_success: boolean | null
  updated_at: string | null
}

type ClusterRow = {
  id: string
  cluster_code: string
  display_name: string | null
  description: string | null
  onboarding_completed: boolean | null
  created_by: string | null
}

type ClusterGuildRow = {
  guild_code: string | null
  display_name: string | null
  enabled: boolean | null
  onboarding_completed: boolean | null
}

export default async function OnboardingDashboardPage() {
  const user = await requireAuthAllowInactive()

  const serviceSupabase = serviceDb()
  const membershipState = await resolveOnboardingMembershipState(
    serviceSupabase,
    user.id
  )

  // Service authority is used past this point; lookup errors fail closed.
  if (membershipState === 'inactive') {
    redirect('/home')
  }
  if (membershipState === 'error') {
    redirect('/auth/error?error=membership_lookup_failed')
  }

  let progress: OnboardingProgress | null = null
  try {
    progress = await getOrCreateOnboardingProgress(serviceSupabase, user.id)
  } catch (error) {
    logger.error(
      { err: error },
      '[OnboardingDashboard] Failed to load progress'
    )
  }

  if (!progress) {
    redirect('/auth/error?error=onboarding_progress_missing')
  }

  const onboardingComplete =
    progress.guild_status === 'complete' &&
    (progress.sync_status === 'complete' ||
      progress.sync_status === 'not_required') &&
    progress.profile_status === 'complete'

  let profile: OnboardingProfile | null = null
  try {
    const { data: playerRow } = await serviceSupabase
      .from('player_mapping')
      .select('role, guild_code, display_name, cluster_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    if (playerRow) {
      const pr = playerRow as Record<string, unknown>
      profile = {
        role: (pr.role as string) ?? null,
        onboarding_complete: onboardingComplete ? true : null,
        onboarding_role_intent: progress.role_intent ?? null,
        guild_code: (pr.guild_code as string) ?? null,
        cluster_code: (pr.cluster_code as string) ?? null,
        display_name: (pr.display_name as string) ?? null
      }
    }
  } catch (error) {
    logger.warn(
      { error: error },
      '[OnboardingDashboard] Failed to load profile row'
    )
  }

  let syncStatus: SyncStatusMeta | null = null
  let latestJob: OnboardingJob | null = null

  if (progress?.guild_code) {
    try {
      const { data: syncRow, error: syncError } = await serviceSupabase
        .from('guild_sync_status')
        .select(
          'guild_code, status, queue_status, records_synced, last_sync, full_sync_success, updated_at'
        )
        .eq('guild_code', progress.guild_code)
        .maybeSingle()

      if (syncError) {
        logger.warn(
          { syncError: syncError },
          '[OnboardingDashboard] Failed to load sync status'
        )
      } else if (syncRow) {
        syncStatus = syncRow as unknown as SyncStatusMeta
      }

      latestJob = await fetchLatestJobForGuild(
        serviceSupabase,
        progress.guild_code
      )
    } catch (syncMetaError) {
      logger.warn(
        { syncMetaError: syncMetaError },
        '[OnboardingDashboard] Sync meta retrieval failed'
      )
    }
  }

  let cluster: ClusterSummary | null = null
  let clusterGuilds: ClusterGuildSummary[] = []

  if (progress?.role_intent === 'leader') {
    try {
      let clusterRow: ClusterRow | null = null

      const { data: createdCluster, error: createdClusterError } =
        await serviceSupabase
          .from('clusters')
          .select(
            'id, cluster_code, display_name, description, onboarding_completed, created_by'
          )
          .eq('created_by', user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

      if (createdClusterError) {
        logger.warn(
          { createdClusterError: createdClusterError },
          '[OnboardingDashboard] Failed to load cluster by creator'
        )
      }

      if (createdCluster) {
        clusterRow = createdCluster as unknown as ClusterRow
      } else if (profile?.cluster_code) {
        const { data: profileCluster, error: profileClusterError } =
          await serviceSupabase
            .from('clusters')
            .select(
              'id, cluster_code, display_name, description, onboarding_completed, created_by'
            )
            .eq('cluster_code', profile.cluster_code)
            .maybeSingle()

        if (profileClusterError) {
          logger.warn(
            { profileClusterError: profileClusterError },
            '[OnboardingDashboard] Failed to load cluster by profile code'
          )
        } else if (profileCluster) {
          clusterRow = profileCluster as unknown as ClusterRow
        }
      }

      if (clusterRow?.cluster_code) {
        const clusterCode = clusterRow.cluster_code as string
        cluster = {
          id: clusterRow.id,
          cluster_code: clusterCode,
          display_name: clusterRow.display_name ?? clusterCode,
          description: clusterRow.description || null,
          onboarding_completed: clusterRow.onboarding_completed ?? null
        }

        const { data: guildRows, error: guildError } = await serviceSupabase
          .from('guild_config')
          .select('guild_code, display_name, enabled, onboarding_completed')
          .eq('cluster_code', clusterCode)
          .order('display_name', { ascending: true })

        if (guildError) {
          logger.warn(
            { guildError: guildError },
            '[OnboardingDashboard] Failed to load cluster guilds'
          )
        } else if (guildRows && guildRows.length > 0) {
          const typedGuildRows = guildRows as unknown as ClusterGuildRow[]
          const validGuildRows = typedGuildRows.filter(
            (row): row is ClusterGuildRow & { guild_code: string } =>
              typeof row.guild_code === 'string' && row.guild_code.length > 0
          )

          const guildCodes = validGuildRows.map((row) => row.guild_code)
          const jobMap = new Map<string, OnboardingJob | null>()

          // Jobs load per guild via fetchLatestJobForGuild.
          void guildCodes

          clusterGuilds = validGuildRows.map((row) => ({
            guild_code: row.guild_code,
            display_name: row.display_name || null,
            enabled: row.enabled,
            onboarding_completed: row.onboarding_completed,
            job: jobMap.get(row.guild_code) || null
          }))
        }
      }
    } catch (clusterError) {
      logger.warn(
        { clusterError: clusterError },
        '[OnboardingDashboard] Cluster data retrieval failed'
      )
    }
  }

  // Shared with GET /api/onboarding/progress so first render and refreshes agree.
  const guildAwaitingFirstClaim = await isGuildAwaitingFirstClaim(
    serviceSupabase,
    progress.guild_code,
    user.id
  )

  return (
    <OnboardingDashboardClient
      guildAwaitingFirstClaim={guildAwaitingFirstClaim}
      user={{
        id: user.id,
        email: user.email || '',
        displayName: profile?.display_name || null
      }}
      initialProgress={progress}
      initialSyncStatus={syncStatus}
      initialJob={latestJob}
      initialCluster={cluster}
      initialClusterGuilds={clusterGuilds}
    />
  )
}

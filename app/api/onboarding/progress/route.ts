import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.progress')
import { getOrCreateOnboardingProgress } from '@/app/lib/onboarding/progress'
import { fetchLatestJobForGuild } from '@/app/lib/onboarding/jobs'
import type {
  OnboardingJob,
  ClusterSummary,
  ClusterGuildSummary
} from '@tacticus/app-core/onboarding.types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { sanitizeInactiveOnboardingProgress } from '@/app/lib/onboarding/inactive-progress'
import { resolveOnboardingMembershipState } from '@/app/lib/onboarding/membership-state'
import { isGuildAwaitingFirstClaim } from '@/app/lib/onboarding/first-claim'

export const GET = withErrorHandler(async () => {
  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Unauthorized' })
    )
    const serviceSupabase = serviceDb()
    const membershipState = await resolveOnboardingMembershipState(
      serviceSupabase,
      user.id
    )

    if (membershipState === 'error') {
      throw Errors.fromResponse(503, {
        error: 'Unable to determine membership'
      })
    }

    const persistedProgress = await getOrCreateOnboardingProgress(
      supabase,
      user.id
    )

    if (!persistedProgress) {
      throw Errors.fromResponse(500, {
        error: 'Unable to load onboarding progress'
      })
    }

    const progress = sanitizeInactiveOnboardingProgress(
      persistedProgress,
      membershipState
    )

    const { data: playerMapping } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('player_id, display_name, guild_code, role, user_id, is_current')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    let clusterCode: string | null = null
    if (playerMapping?.guild_code) {
      const guildConfig = await GuildConfigService.getBasic(
        serviceSupabase,
        playerMapping.guild_code
      )
      clusterCode = guildConfig?.cluster_code ?? null
    }

    const profile = playerMapping
      ? {
          user_id: playerMapping.user_id,
          role: playerMapping.role,
          onboarding_complete: !!playerMapping.user_id,
          guild_code: playerMapping.guild_code,
          display_name: playerMapping.display_name,
          cluster_code: clusterCode
        }
      : null

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
      guild_code: string
      display_name: string | null
      enabled: boolean | null
      onboarding_completed: boolean | null
    }

    let syncMeta: SyncStatusMeta | null = null
    let latestJob: OnboardingJob | null = null
    let cluster: ClusterSummary | null = null
    let clusterGuilds: ClusterGuildSummary[] = []

    try {
      if (progress.guild_code) {
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
            'Onboarding sync status lookup failed'
          )
        } else if (syncRow) {
          syncMeta = {
            guild_code: syncRow.guild_code,
            status: syncRow.status,
            queue_status: syncRow.queue_status,
            records_synced: syncRow.records_synced,
            last_sync: syncRow.last_sync,
            full_sync_success: syncRow.full_sync_success,
            updated_at: syncRow.updated_at
          }
        }

        latestJob = await fetchLatestJobForGuild(
          serviceSupabase,
          progress.guild_code
        )
      }
    } catch (syncMetaError) {
      logger.warn(
        { syncMetaError: syncMetaError },
        'Onboarding sync meta retrieval failed'
      )
    }

    try {
      if (membershipState !== 'inactive' && progress.role_intent === 'leader') {
        let clusterRow: ClusterRow | null = null

        const { data: leaderCluster, error: leaderClusterError } =
          await serviceSupabase
            .from('clusters')
            .select(
              'id, cluster_code, display_name, description, onboarding_completed, created_by'
            )
            .eq('created_by', user.id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

        if (leaderClusterError) {
          logger.warn(
            { leaderClusterError: leaderClusterError },
            'Onboarding cluster lookup by creator failed'
          )
        }

        if (leaderCluster) {
          clusterRow = leaderCluster
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
              'Onboarding cluster lookup by code failed'
            )
          } else if (profileCluster) {
            clusterRow = profileCluster
          }
        }

        if (clusterRow) {
          cluster = {
            id: clusterRow.id,
            cluster_code: clusterRow.cluster_code,
            display_name: clusterRow.display_name ?? '',
            description: clusterRow.description || null,
            onboarding_completed: clusterRow.onboarding_completed ?? null
          }

          let clusterGuildRowsData: ClusterGuildRow[] = []
          try {
            const clusterGuildRows = await GuildConfigService.getClusterGuilds(
              serviceSupabase,
              clusterRow.cluster_code,
              {
                includeDisabled: true,
                orderBy: 'display_name',
                throwOnError: true
              }
            )
            clusterGuildRowsData = clusterGuildRows as ClusterGuildRow[]
          } catch (clusterGuildError) {
            logger.warn(
              { clusterGuildError: clusterGuildError },
              'Onboarding cluster guild lookup failed'
            )
          }

          if (clusterGuildRowsData.length > 0) {
            const guildCodes = clusterGuildRowsData
              .map((row) => row.guild_code)
              .filter((code): code is string => Boolean(code))

            const jobMap = new Map<string, OnboardingJob | null>()
            if (guildCodes.length > 0) {
              const { data: jobRows, error: jobError } = await serviceSupabase
                .from('onboarding_jobs')
                .select('*')
                .in('guild_code', guildCodes)
                .order('created_at', { ascending: false })

              if (jobError) {
                logger.warn(
                  { jobError: jobError },
                  'Onboarding cluster job lookup failed'
                )
              } else {
                const jobRowsData: OnboardingJob[] =
                  (jobRows as unknown as OnboardingJob[]) ?? []
                for (const row of jobRowsData) {
                  if (!row.guild_code || jobMap.has(row.guild_code)) continue
                  jobMap.set(row.guild_code, row)
                }
              }
            }

            clusterGuilds = clusterGuildRowsData.map((row) => ({
              guild_code: row.guild_code,
              display_name: row.display_name || null,
              enabled: row.enabled || false,
              onboarding_completed: row.onboarding_completed || false,
              job: row.guild_code ? jobMap.get(row.guild_code) || null : null
            }))
          }
        }
      }
    } catch (clusterError) {
      logger.warn(
        { clusterError: clusterError },
        'Onboarding cluster data retrieval failed'
      )
    }

    // RLS hides an unjoined guild's roster from the dashboard, so compute it here.
    const guildAwaitingFirstClaim = await isGuildAwaitingFirstClaim(
      serviceSupabase,
      progress.guild_code,
      user.id
    )

    return NextResponse.json({
      progress,
      profile: profile || null,
      syncStatus: syncMeta,
      job: latestJob,
      cluster,
      clusterGuilds,
      guildAwaitingFirstClaim
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Onboarding progress fetch failed')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

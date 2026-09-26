import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.cluster.add-guild')
import { enqueueOnboardingJob } from '@/app/lib/onboarding/jobs'
import {
  getOrCreateOnboardingProgress,
  resetStatusFields
} from '@/app/lib/onboarding/progress'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { createDirectClient } from '@/app/lib/network/direct-supabase'
import {
  fetchCreateConfig,
  isCreateConfigTimeoutError
} from '@/app/api/onboarding/_lib/create-config-fetch'

type CreateConfigPayload = {
  details?: string
  error?: string
  data?: {
    // Differs from the submitted code when an existing row's code was adopted.
    guild_code?: string
    claimed?: boolean
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authedSupabase = await db()
  const user = await requireSessionUser(authedSupabase, () =>
    Errors.fromResponse(401, { error: 'Unauthorized' })
  )

  const { clusterCode, guildCode, guildName, apiKey } = await request.json()

  const normalizedClusterCode =
    typeof clusterCode === 'string' ? clusterCode.trim().toUpperCase() : ''
  const normalizedGuildCode =
    typeof guildCode === 'string' ? guildCode.trim().toUpperCase() : ''
  const normalizedGuildName =
    typeof guildName === 'string' ? guildName.trim() : ''
  const sanitizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : ''

  if (
    !normalizedClusterCode ||
    !normalizedGuildCode ||
    !normalizedGuildName ||
    !sanitizedApiKey
  ) {
    throw Errors.fromResponse(400, {
      error: 'Cluster code, guild code, guild name, and API key are required.'
    })
  }

  const serviceSupabase = serviceDb()

  try {
    const { data: clusterRow, error: clusterError } = await serviceSupabase
      .from('clusters')
      .select('id, cluster_code, created_by')
      .eq('cluster_code', normalizedClusterCode)
      .maybeSingle()

    if (clusterError) {
      logger.error(
        { err: clusterError },
        '[cluster/add-guild] Cluster lookup failed'
      )
      throw Errors.fromResponse(500, {
        error: 'Unable to verify cluster ownership.',
        details: clusterError.message
      })
    }

    if (!clusterRow) {
      throw Errors.fromResponse(404, {
        error: `Cluster ${normalizedClusterCode} was not found.`
      })
    }

    // Mirrors the wi3136_cluster_leaders_update RLS policy.
    const isClusterCreator = clusterRow.created_by === user.id
    if (!isClusterCreator) {
      const { data: adminCheck, error: adminCheckError } = await serviceSupabase
        .from('player_mapping')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('is_current', true)
        .eq('is_app_admin', true)
        .maybeSingle()

      if (adminCheckError) {
        logger.error(
          { err: adminCheckError },
          '[cluster/add-guild] Admin check failed'
        )
        throw Errors.fromResponse(500, {
          error: 'Unable to verify cluster membership.',
          details: adminCheckError.message
        })
      }

      const isAdmin = !!adminCheck
      if (!isAdmin) {
        const { data: clusterGuildCodes, error: clusterGuildCodesError } =
          await serviceSupabase
            .from('guild_config')
            .select('guild_code')
            .eq('cluster_code', normalizedClusterCode)

        if (clusterGuildCodesError) {
          logger.error(
            { err: clusterGuildCodesError },
            '[cluster/add-guild] Cluster guild codes lookup failed'
          )
          throw Errors.fromResponse(500, {
            error: 'Unable to verify cluster membership.',
            details: clusterGuildCodesError.message
          })
        }

        const clusterCodes = clusterGuildCodes?.map((g) => g.guild_code) ?? []

        if (clusterCodes.length === 0) {
          throw Errors.fromResponse(403, {
            error:
              'Only the cluster creator or a guild leader within the cluster can add guilds.'
          })
        }

        const { data: leaderGuilds, error: leaderGuildsError } =
          await serviceSupabase
            .from('player_mapping')
            .select('guild_code')
            .eq('user_id', user.id)
            .eq('is_current', true)
            .eq('role', 'leader')
            .in('guild_code', clusterCodes)

        if (leaderGuildsError) {
          logger.error(
            { err: leaderGuildsError },
            '[cluster/add-guild] Leader guild lookup failed'
          )
          throw Errors.fromResponse(500, {
            error: 'Unable to verify cluster membership.',
            details: leaderGuildsError.message
          })
        }

        if (!leaderGuilds || leaderGuilds.length === 0) {
          throw Errors.fromResponse(403, {
            error:
              'Only the cluster creator or a guild leader within the cluster can add guilds.'
          })
        }
      }
    }

    // An unfinished existing row in this cluster is a retry; allow it so job state can be repaired.
    const existingGuild = await GuildConfigService.exists(
      serviceSupabase,
      normalizedGuildCode
    )
    let shouldCreateGuildConfig = true

    if (existingGuild) {
      const { data: existingGuildRow, error: existingGuildError } =
        await serviceSupabase
          .from('guild_config')
          .select(
            'guild_code, display_name, cluster_code, onboarding_completed'
          )
          .eq('guild_code', normalizedGuildCode)
          .maybeSingle()

      if (existingGuildError) {
        logger.error(
          { err: existingGuildError },
          '[cluster/add-guild] Existing guild lookup failed'
        )
        throw Errors.fromResponse(500, {
          error: 'Unable to verify existing guild cluster assignment.',
          details: existingGuildError.message
        })
      }

      const existingClusterCode =
        typeof existingGuildRow?.cluster_code === 'string'
          ? existingGuildRow.cluster_code.trim().toUpperCase()
          : ''

      if (existingClusterCode !== normalizedClusterCode) {
        throw Errors.fromResponse(409, {
          error: `Guild ${normalizedGuildCode} already exists in analytics.`
        })
      }

      if (existingGuildRow?.onboarding_completed === true) {
        throw Errors.fromResponse(409, {
          error: `Guild ${normalizedGuildCode} already exists in analytics.`
        })
      }

      shouldCreateGuildConfig = false
    }

    // create-config may adopt an existing row's code, so the typed one may not exist.
    let committedGuildCode = normalizedGuildCode
    let claimedExistingGuild = false

    if (shouldCreateGuildConfig) {
      let createConfigResponse: Response
      let createPayload: CreateConfigPayload
      try {
        createConfigResponse = await fetchCreateConfig(request, {
          guild_code: normalizedGuildCode,
          display_name: normalizedGuildName,
          api_key: sanitizedApiKey,
          cluster_code: normalizedClusterCode
        })
        createPayload =
          (await createConfigResponse.json()) as CreateConfigPayload
      } catch (error) {
        if (isCreateConfigTimeoutError(error)) {
          throw Errors.fromResponse(504, {
            error: 'Guild registration timed out. Please retry.'
          })
        }

        throw error
      }

      if (!createConfigResponse.ok) {
        const message =
          createPayload?.details ||
          createPayload?.error ||
          'Failed to register guild configuration.'
        throw Errors.fromResponse(createConfigResponse.status || 500, {
          error: message
        })
      }

      committedGuildCode = createPayload.data?.guild_code || normalizedGuildCode
      claimedExistingGuild = createPayload.data?.claimed === true
      if (committedGuildCode !== normalizedGuildCode) {
        logger.info(
          {
            requestedGuildCode: normalizedGuildCode,
            committedGuildCode
          },
          '[cluster/add-guild] create-config adopted an existing guild_code; keying post-create work on the committed code'
        )
      }
    }

    const progress = await getOrCreateOnboardingProgress(
      authedSupabase,
      user.id
    )
    if (!progress) {
      throw Errors.fromResponse(500, {
        error: 'Unable to load onboarding progress for cluster owner.'
      })
    }

    const { job, error: jobError } = await enqueueOnboardingJob(
      serviceSupabase,
      'guild_initial_sync',
      {
        userId: user.id,
        guildCode: committedGuildCode,
        clusterCode: normalizedClusterCode,
        payload: {
          source: 'cluster_onboarding',
          requestedAt: new Date().toISOString()
        }
      }
    )

    if (!job) {
      throw Errors.fromResponse(500, {
        error: jobError || 'Unable to queue initial sync job for the guild.'
      })
    }

    // Direct REST because work_queue is not in the generated types.
    const backfillEnqueue = await createDirectClient().mutate(
      'work_queue',
      'POST',
      {
        job_type: 'guild_historical_backfill',
        job_class: 'batch',
        payload: {
          guild_code: committedGuildCode,
          source: 'cluster_onboarding'
        },
        dedupe_key: `guild_historical_backfill:${committedGuildCode}:onboarding`
      },
      { Prefer: 'resolution=ignore-duplicates' }
    )
    if (backfillEnqueue.error) {
      logger.warn(
        { err: backfillEnqueue.error, guild_code: committedGuildCode },
        '[cluster/add-guild] Failed to enqueue guild_historical_backfill (onboarding still succeeded)'
      )
    }

    await authedSupabase
      .from('onboarding_progress')
      .update(
        resetStatusFields(progress, {
          sync_status: 'pending',
          sync_error_message: null,
          sync_can_retry: true
        })
      )
      .eq('user_id', progress.user_id)

    return NextResponse.json({
      success: true,
      job,
      guild: {
        guild_code: committedGuildCode,
        display_name: normalizedGuildName,
        claimed: claimedExistingGuild
      }
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    logger.error({ err: error }, '[cluster/add-guild] Unexpected error')
    const message =
      error instanceof Error ? error.message : 'Internal server error'
    throw Errors.fromResponse(500, { error: message })
  }
})

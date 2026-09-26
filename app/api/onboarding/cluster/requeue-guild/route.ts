import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.cluster.requeue-guild')
import { enqueueOnboardingJob } from '@/app/lib/onboarding/jobs'
import {
  getOrCreateOnboardingProgress,
  resetStatusFields
} from '@/app/lib/onboarding/progress'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authedSupabase = await db()
  const user = await requireSessionUser(authedSupabase, () =>
    Errors.fromResponse(401, { error: 'Unauthorized' })
  )

  const { clusterCode, guildCode } = await request.json()

  const normalizedClusterCode =
    typeof clusterCode === 'string' ? clusterCode.trim().toUpperCase() : ''
  const normalizedGuildCode =
    typeof guildCode === 'string' ? guildCode.trim().toUpperCase() : ''

  if (!normalizedClusterCode || !normalizedGuildCode) {
    throw Errors.fromResponse(400, {
      error: 'Cluster code and guild code are required.'
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
        '[cluster/requeue-guild] Cluster lookup failed'
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

    if (clusterRow.created_by !== user.id) {
      throw Errors.fromResponse(403, {
        error: 'Only the cluster owner can requeue guild syncs.'
      })
    }

    let guildRow = null as {
      guild_code: string
      cluster_code: string | null
      enabled: boolean | null
    } | null
    try {
      guildRow = await GuildConfigService.getBasic(
        serviceSupabase,
        normalizedGuildCode,
        {
          throwOnError: true
        }
      )
    } catch (guildError) {
      logger.error(
        { err: guildError },
        '[cluster/requeue-guild] Guild lookup failed'
      )
      throw Errors.fromResponse(500, {
        error: 'Unable to verify guild record.'
      })
    }

    if (!guildRow) {
      throw Errors.fromResponse(404, {
        error: `Guild ${normalizedGuildCode} is not registered.`
      })
    }

    if (guildRow.cluster_code?.toUpperCase() !== normalizedClusterCode) {
      throw Errors.fromResponse(400, {
        error: `Guild ${normalizedGuildCode} is not linked to cluster ${normalizedClusterCode}.`
      })
    }

    const { job: newJob, error: jobError } = await enqueueOnboardingJob(
      serviceSupabase,
      'guild_initial_sync',
      {
        userId: user.id,
        guildCode: normalizedGuildCode,
        clusterCode: normalizedClusterCode,
        payload: {
          source: 'cluster_requeue',
          requestedAt: new Date().toISOString()
        }
      }
    )

    if (!newJob) {
      throw Errors.fromResponse(500, {
        error: jobError || 'Unable to queue guild sync. Please try again.'
      })
    }

    const progress = await getOrCreateOnboardingProgress(
      authedSupabase,
      user.id
    )
    if (progress) {
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
    }

    return NextResponse.json({
      success: true,
      job: newJob
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    logger.error({ err: error }, '[cluster/requeue-guild] Unexpected error')
    const message =
      error instanceof Error ? error.message : 'Internal server error'
    throw Errors.fromResponse(500, { error: message })
  }
})

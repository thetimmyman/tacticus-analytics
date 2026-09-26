import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.data-sync.start')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  getOrCreateOnboardingProgress,
  resetStatusFields
} from '@/app/lib/onboarding/progress'
import {
  enqueueOnboardingJob,
  fetchOnboardingJobById
} from '@/app/lib/onboarding/jobs'
import { processGuildInitialSyncJob } from '@/app/lib/onboarding/job-runner'
import { resolveAuthorizedGuildCode } from '@/app/lib/onboarding/guild-authority'
import { v4 as uuidv4 } from 'uuid'

interface DataSyncStartPayload {
  /** The strongest (for a fresh leader, the only) proof of which guild this sync is for. */
  apiKey?: unknown
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authedSupabase = await db()
  const user = await requireSessionUser(authedSupabase, () =>
    Errors.fromResponse(401, { error: 'Unauthorized' })
  )

  try {
    const serviceSupabase = serviceDb()
    const body = (await request
      .json()
      .catch(() => ({}))) as DataSyncStartPayload
    const submittedKey =
      typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

    const progress = await getOrCreateOnboardingProgress(
      authedSupabase,
      user.id
    )

    if (!progress) {
      throw Errors.fromResponse(500, {
        error: 'Unable to load onboarding progress'
      })
    }

    if (progress.sync_status === 'not_required') {
      return NextResponse.json({
        progress,
        message: 'Sync not required for existing guild onboarding path'
      })
    }

    // The guild comes from Tacticus or a server-written roster seat, never from `progress`, which
    // users can rewrite; trusting it would let any account spend another guild's credential.
    const authority = await resolveAuthorizedGuildCode({
      service: serviceSupabase,
      userId: user.id,
      apiKey: submittedKey
    })

    if (!authority.ok) {
      logger.warn(
        {
          userId: user.id,
          authorityCode: authority.code,
          keySubmitted: submittedKey.length > 0,
          claimedGuildCode: progress.guild_code
        },
        '[Onboarding] Refused a data sync with no server-derived guild authority'
      )
      // Errors.fromResponse's 404 path drops the metadata code the client branches on.
      return NextResponse.json(
        { error: { code: authority.code, message: authority.message } },
        { status: authority.status }
      )
    }

    const guildCode = authority.guildCode

    if (progress.guild_code && progress.guild_code !== guildCode) {
      // Possibly stale, but also an exploit's shape.
      logger.warn(
        {
          userId: user.id,
          claimedGuildCode: progress.guild_code,
          authorizedGuildCode: guildCode,
          authoritySource: authority.source,
          authorityElevation: authority.elevation
        },
        '[Onboarding] Ignoring a client-authored guild code that disagrees with the derived authority'
      )
    }

    const { job, error: enqueueError } = await enqueueOnboardingJob(
      serviceSupabase,
      'guild_initial_sync',
      {
        userId: user.id,
        guildCode,
        clusterCode: null,
        payload: {
          source: 'onboarding_dashboard',
          requestedAt: new Date().toISOString(),
          authoritySource: authority.source,
          authorityElevation: authority.elevation
        }
      }
    )

    if (!job) {
      logger.warn(
        {
          userId: user.id,
          guildCode,
          queueError: enqueueError
        },
        '[Onboarding] Job queue failed, attempting direct sync fallback'
      )

      const fallbackJob = {
        id: uuidv4(),
        user_id: user.id,
        // The fallback spends the same credential, so needs the same proof.
        guild_code: guildCode,
        cluster_code: null,
        job_type: 'guild_initial_sync' as const,
        status: 'queued' as const,
        attempts: 0,
        max_attempts: 1,
        payload: {
          source: 'onboarding_dashboard_fallback',
          queueError: enqueueError
        },
        result: null,
        error_message: null,
        last_error_at: null,
        started_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const progressInFlight = {
        ...progress,
        guild_code: guildCode,
        sync_status: 'syncing' as const,
        sync_progress: 0,
        sync_records_synced: 0,
        sync_error_message: null,
        sync_can_retry: false
      }

      await authedSupabase
        .from('onboarding_progress')
        .update(
          resetStatusFields(progress, {
            guild_code: guildCode,
            guild_status: 'complete',
            sync_status: 'syncing',
            sync_progress: 0,
            sync_records_synced: 0,
            sync_error_message: null,
            sync_can_retry: false
          })
        )
        .eq('user_id', user.id)

      const fallbackResult = await processGuildInitialSyncJob({
        job: fallbackJob,
        authedSupabase,
        serviceSupabase,
        progress: progressInFlight,
        request
      })

      if (!fallbackResult.success) {
        throw Errors.fromResponse(500, {
          error: fallbackResult.error || 'Sync failed. Please try again.',
          queueError: enqueueError
        })
      }

      const latestProgress = await getOrCreateOnboardingProgress(
        authedSupabase,
        user.id
      )
      return NextResponse.json({
        progress: latestProgress,
        job: fallbackJob,
        message: 'Initial sync completed successfully (fallback mode).',
        fallback: true
      })
    }

    // UI state only; nothing reads it for authority.
    const progressInFlight: typeof progress = {
      ...progress,
      guild_code: guildCode,
      sync_status: 'syncing',
      sync_progress: 0,
      sync_records_synced: 0,
      sync_error_message: null,
      sync_can_retry: false
    }

    await authedSupabase
      .from('onboarding_progress')
      .update(
        resetStatusFields(progress, {
          guild_code: guildCode,
          guild_status: 'complete',
          sync_status: 'syncing',
          sync_progress: 0,
          sync_records_synced: 0,
          sync_error_message: null,
          sync_can_retry: false
        })
      )
      .eq('user_id', user.id)

    const shouldProcessInline =
      process.env.ONBOARDING_PROCESS_JOBS_INLINE !== 'false'

    if (!shouldProcessInline) {
      return NextResponse.json(
        {
          queued: true,
          job,
          message: 'Sync job queued. It will be processed shortly.'
        },
        { status: 202 }
      )
    }

    const result = await processGuildInitialSyncJob({
      job,
      authedSupabase,
      serviceSupabase,
      progress: progressInFlight,
      request
    })

    if (!result.success) {
      throw Errors.fromResponse(500, {
        error: result.error || 'Initial sync job failed. Please try again.'
      })
    }

    const latestProgress = await getOrCreateOnboardingProgress(
      authedSupabase,
      user.id
    )
    const refreshedJob = await fetchOnboardingJobById(serviceSupabase, job.id)

    return NextResponse.json({
      progress: latestProgress,
      job: refreshedJob ?? job,
      message: 'Initial sync completed successfully.'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Onboarding data sync failed')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

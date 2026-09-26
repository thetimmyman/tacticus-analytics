import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.jobs.process')
import { processGuildInitialSyncJob } from '@/app/lib/onboarding/job-runner'
import type { OnboardingJob } from '@tacticus/app-core/onboarding.types'
import { resetStatusFields } from '@/app/lib/onboarding/progress'
import type { OnboardingProgress } from '@/app/lib/onboarding/progress'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireBearerSecret } from '@/app/lib/auth/require-header-secret'

export const dynamic = 'force-dynamic'

const DEFAULT_BATCH_SIZE = 3

export const POST = withErrorHandler(async (request: NextRequest) => {
  // Fails closed (500) when ONBOARDING_WORKER_TOKEN is unset.
  requireBearerSecret(request, {
    secret: process.env.ONBOARDING_WORKER_TOKEN,
    envVarName: 'ONBOARDING_WORKER_TOKEN',
    endpoint: '/api/onboarding/jobs/process'
  })

  const limitRaw = process.env.ONBOARDING_JOB_BATCH_SIZE
  const batchSize = Number.isInteger(Number(limitRaw))
    ? Math.max(1, Number(limitRaw))
    : DEFAULT_BATCH_SIZE

  const serviceSupabase = serviceDb()
  const processed: Array<{
    id: string
    success: boolean
    error?: string | null
  }> = []
  const skipped: Array<{ id: string; reason: string }> = []

  for (let index = 0; index < batchSize; index += 1) {
    const { data: jobCandidate, error: fetchError } = await serviceSupabase
      .from('onboarding_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (fetchError) {
      logger.error(
        { err: fetchError },
        '[OnboardingJobsWorker] Failed to fetch job'
      )
      throw Errors.fromResponse(500, {
        error: 'Unable to fetch jobs',
        details: fetchError.message
      })
    }

    if (!jobCandidate) {
      break
    }

    const { data: job, error: claimError } = await serviceSupabase
      .from('onboarding_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString()
      })
      .eq('id', jobCandidate.id)
      .eq('status', 'queued')
      .select('*')
      .maybeSingle()

    if (claimError) {
      logger.warn(
        { claimError: claimError },
        '[OnboardingJobsWorker] Failed to claim job'
      )
      skipped.push({ id: jobCandidate.id, reason: 'claim_failed' })
      continue
    }

    if (!job) {
      skipped.push({ id: jobCandidate.id, reason: 'already_claimed' })
      continue
    }

    if (job.attempts >= job.max_attempts) {
      await serviceSupabase
        .from('onboarding_jobs')
        .update({
          status: 'failed',
          error_message: 'Maximum attempts reached',
          last_error_at: new Date().toISOString()
        })
        .eq('id', job.id)
      processed.push({
        id: job.id,
        success: false,
        error: 'Maximum attempts reached'
      })
      continue
    }

    if (!job.user_id) {
      await serviceSupabase
        .from('onboarding_jobs')
        .update({
          status: 'failed',
          error_message: 'Job missing user_id',
          last_error_at: new Date().toISOString()
        })
        .eq('id', job.id)
      processed.push({
        id: job.id,
        success: false,
        error: 'Job missing user_id'
      })
      continue
    }

    const { data: progress, error: progressError } = await serviceSupabase
      .from('onboarding_progress')
      .select('*')
      .eq('user_id', job.user_id)
      .maybeSingle()

    if (progressError || !progress) {
      const message = progressError?.message || 'Onboarding progress not found'
      await serviceSupabase
        .from('onboarding_jobs')
        .update({
          status: 'failed',
          error_message: message,
          last_error_at: new Date().toISOString()
        })
        .eq('id', job.id)
      processed.push({ id: job.id, success: false, error: message })
      continue
    }

    // The app-core overlay narrows columns the generated Row widens.
    const onboardingProgress = progress as OnboardingProgress

    const result = await processGuildInitialSyncJob({
      job: job as unknown as OnboardingJob,
      authedSupabase: serviceSupabase,
      serviceSupabase,
      progress: onboardingProgress,
      request: undefined
    })

    if (!result.success) {
      const nextAttempts = job.attempts + 1
      if (nextAttempts < (job.max_attempts || 3)) {
        await serviceSupabase
          .from('onboarding_jobs')
          .update({
            status: 'queued',
            error_message: result.error ?? null,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id)

        await serviceSupabase
          .from('onboarding_progress')
          .update(
            resetStatusFields(onboardingProgress, {
              sync_status: 'pending',
              sync_error_message: result.error ?? null,
              sync_can_retry: true
            })
          )
          .eq('user_id', progress.user_id)
      }
    }

    processed.push({
      id: job.id,
      success: result.success,
      error: result.error ?? null
    })
  }

  return NextResponse.json({
    processed: processed.length,
    skipped,
    jobs: processed
  })
})

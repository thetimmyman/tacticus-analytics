import { ProviderAdmissionError } from '@/supabase/functions/_shared/provider-admission'
import { deferSyncJob } from './sync-job-defer'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { callRpc } from './worker-utils'
import { readCompletedAttempt } from './completion-reconciliation'
import { currentProviderMetrics } from '@/app/lib/network/provider-metrics'
import {
  TacticusApiError,
  type ServiceSupabaseClient,
  type SyncJob,
  type WorkerResult
} from './worker-types'

const logger = createComponentLogger('lib.sync.sync-job-lifecycle')

export async function failMissingGuildConfig(
  job: SyncJob,
  supabase: ServiceSupabaseClient,
  workerId: string,
  errorMessage: string
) {
  // Permanent: the guild won't exist on retry.
  const { error } = await callRpc<unknown>(supabase, 'fail_job', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: `Guild config not found (permanent): ${errorMessage}`,
    p_progress: {}
  })
  if (error) {
    logger.warn(
      { workerId, jobId: job.id, err: error },
      'Failed to record permanent sync-job state'
    )
  }
  await supabase
    .from('sync_queue')
    .update({
      attempts: 999,
      status: 'failed',
      completed_at: new Date().toISOString()
    })
    .eq('id', job.id)
  logger.warn(
    { workerId, jobId: job.id, guildCode: job.guild_code },
    'Sync job permanently failed because guild config was not found'
  )
}

export async function completeSyncJob(
  job: SyncJob,
  supabase: ServiceSupabaseClient,
  workerId: string,
  result: WorkerResult
) {
  const { data, error, status } = await callRpc<boolean>(
    supabase,
    'complete_job',
    {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_progress: {
        records_processed: result.recordsProcessed,
        players_updated: result.playersUpdated,
        ...(result.errors.length > 0 && {
          batch_errors: result.errors.slice(0, 10)
        }),
        ...(result.phaseMs !== undefined && { phase_ms: result.phaseMs }),
        ...(result.syncPath !== undefined && { sync_path: result.syncPath }),
        ...(result.snapshotEntries !== undefined && {
          snapshot_entries: result.snapshotEntries
        }),
        ...(result.storedKeys !== undefined && {
          stored_keys: result.storedKeys
        }),
        ...(result.newEntries !== undefined && {
          new_entries: result.newEntries
        })
      },
      p_metrics: {
        records_processed: result.recordsProcessed,
        players_updated: result.playersUpdated,
        ...(currentProviderMetrics() ?? {})
      }
    }
  )
  if (error) {
    const originalError = new Error(
      `Failed to mark job complete: ${error.message ?? 'Unknown error'}`
    )
    // complete_job has no generation predicate, so it is never retried. A lost
    // gateway response can only be proven by reading the already-committed row.
    if (data !== true) {
      const completedAt = await readCompletedAttempt({
        job,
        supabase,
        workerId,
        status
      })
      if (completedAt !== null) {
        result.success = true
        await advanceReconciledSuccessClock(job, supabase, result, completedAt)
        logger.info(
          `[Worker ${workerId}] Job ${job.id} completed after a lost completion response`
        )
        return
      }
    }
    throw originalError
  }
  if (data !== true) {
    throw new Error('Job completion refused: worker claim is no longer active')
  }
  result.success = true
  await advanceSuccessClock(job, supabase, result)
  logger.info(
    `[Worker ${workerId}] Job ${job.id} completed: ${result.recordsProcessed} records`
  )
}

const RAID_INGEST_JOB_TYPES = new Set([
  'full_sync',
  'incremental_sync',
  'realtime_sync'
])

/** Advances the success clock; mirrors the edge rule (raid job types, data landed, no upsert failures). */
async function advanceSuccessClock(
  job: SyncJob,
  supabase: ServiceSupabaseClient,
  result: WorkerResult
): Promise<void> {
  if (!shouldAdvanceSuccessClock(job, result)) {
    return
  }
  const { error } = await supabase
    .from('guild_config')
    .update({ last_successful_sync: new Date().toISOString() })
    .eq('guild_code', job.guild_code)
  if (error) {
    logger.warn(
      { jobId: job.id, guildCode: job.guild_code, err: error },
      'Failed to advance last_successful_sync after a clean worker sync'
    )
  }
}

/**
 * A reconciled completion uses the committed `completed_at` at full database
 * precision. The conditional update makes the write atomic with respect to a
 * newer clock value written by another attempt.
 */
async function advanceReconciledSuccessClock(
  job: SyncJob,
  supabase: ServiceSupabaseClient,
  result: WorkerResult,
  completedAt: string
): Promise<void> {
  if (!shouldAdvanceSuccessClock(job, result)) {
    return
  }
  const deadline = job.reconciliationDeadlineMs
  if (
    typeof deadline !== 'number' ||
    !Number.isFinite(deadline) ||
    deadline <= Date.now()
  ) {
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(1500, Math.floor(deadline - Date.now())))
  )
  try {
    if (Date.now() >= deadline) return
    const { error } = await supabase
      .from('guild_config')
      .update({ last_successful_sync: completedAt })
      .eq('guild_code', job.guild_code)
      .abortSignal(controller.signal)
      .or(`last_successful_sync.is.null,last_successful_sync.lt.${completedAt}`)
    if (error) {
      logger.warn(
        { jobId: job.id, guildCode: job.guild_code, err: error },
        'Failed to advance last_successful_sync after a reconciled worker sync'
      )
    }
  } catch (error) {
    logger.warn(
      { jobId: job.id, guildCode: job.guild_code, err: error },
      'Failed to advance last_successful_sync after a reconciled worker sync'
    )
  } finally {
    clearTimeout(timer)
  }
}

function shouldAdvanceSuccessClock(
  job: SyncJob,
  result: WorkerResult
): boolean {
  return (
    RAID_INGEST_JOB_TYPES.has(job.job_type) &&
    result.raidDataLanded === true &&
    !(result.upsertFailures > 0)
  )
}

// Gateway throttling also returns 403, so 401/403 invalidate only after 3
// consecutive failures; 404 is immediate.
async function recordCredentialFailure(
  error: TacticusApiError,
  supabase: ServiceSupabaseClient,
  workerId: string
) {
  if (error.statusCode === 404) {
    await supabase
      .from('guild_config')
      .update({ api_key_is_valid: false })
      .eq('guild_code', error.guildCode)
    return
  }
  if (error.statusCode !== 401 && error.statusCode !== 403) return

  const { data, error: readError } = await supabase
    .from('guild_config')
    .select('consecutive_sync_failures')
    .eq('guild_code', error.guildCode)
    .maybeSingle()
  if (readError) {
    logger.warn(
      { workerId, guildCode: error.guildCode },
      'Strike-count read failed; skipping strike update this round'
    )
    return
  }

  const failures = (data?.consecutive_sync_failures ?? 0) + 1
  await supabase
    .from('guild_config')
    .update(
      failures >= 3
        ? { api_key_is_valid: false, consecutive_sync_failures: failures }
        : { consecutive_sync_failures: failures }
    )
    .eq('guild_code', error.guildCode)
  if (failures < 3) {
    logger.warn(
      { workerId, guildCode: error.guildCode, failures },
      'Guild credential auth failure; key not yet marked invalid'
    )
  }
}

export async function failSyncJob(
  error: unknown,
  job: SyncJob,
  supabase: ServiceSupabaseClient,
  workerId: string,
  result: WorkerResult
) {
  if (error instanceof ProviderAdmissionError) {
    const hold = error.retryAfterSeconds
    // The authority retains the full provider hold. This is only a queue
    // recheck interval, never a provider retry or a JavaScript sleep timer.
    const recheckSeconds =
      hold !== undefined && Number.isFinite(hold) && hold > 0
        ? Math.min(300, Math.max(1, hold))
        : 60
    await deferSyncJob(job, supabase, workerId, {
      delayMs: recheckSeconds * 1000,
      reason: 'provider_admission',
      progress: {
        ...(hold !== undefined && { provider_retry_after_seconds: hold }),
        ...(currentProviderMetrics() ?? {})
      }
    })
    result.errors.push('Provider traffic deferred')
    return
  }
  rethrowIfAppError(error)
  const errorMessage = error instanceof Error ? error.message : 'Unknown error'
  result.errors.push(errorMessage)

  const { error: failError } = await callRpc<unknown>(supabase, 'fail_job', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: errorMessage,
    p_progress: {
      records_processed: result.recordsProcessed,
      players_updated: result.playersUpdated,
      ...(result.phaseMs !== undefined && { phase_ms: result.phaseMs }),
      ...(currentProviderMetrics() ?? {})
    }
  })
  if (failError) {
    logger.warn(
      `[Worker ${workerId}] Failed to mark job ${job.id} as failed: ${failError.message ?? 'Unknown error'}`
    )
  }

  const isPermanent = error instanceof TacticusApiError && error.isPermanent
  if (isPermanent) {
    // attempts=999 prevents zombie pending jobs.
    await supabase
      .from('sync_queue')
      .update({
        attempts: 999,
        status: 'failed',
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id)
    await recordCredentialFailure(error, supabase, workerId)
    logger.warn(
      {
        workerId,
        jobId: job.id,
        guildCode: error.guildCode,
        statusCode: error.statusCode
      },
      'Sync job permanently failed after Tacticus API response'
    )
    return
  }

  logger.error({ err: error, workerId, jobId: job.id }, 'Sync job failed')
  captureSentryException(error, {
    tags: {
      component: 'sync-worker',
      guild_code: job.guild_code,
      job_type: job.job_type
    },
    extra: { jobId: job.id, workerId }
  })
}

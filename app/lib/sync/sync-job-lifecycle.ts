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
  TRANSIENT_NONCOUNTING_HTTP_STATUSES,
  type ServiceSupabaseClient,
  type SyncJob,
  type WorkerResult
} from './worker-types'

const logger = createComponentLogger('lib.sync.sync-job-lifecycle')

/** Recoverable upstream statuses: throttled/transient 4xx plus every 5xx. */
function isTransientHttpStatus(status: number): boolean {
  return (
    (status >= 500 && status <= 599) ||
    TRANSIENT_NONCOUNTING_HTTP_STATUSES.has(status)
  )
}

const TRANSIENT_ERROR_CODES = new Set([
  '502',
  '503',
  '504',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
])

const TRANSIENT_SYNC_MESSAGE_PATTERNS: readonly RegExp[] = [
  /an invalid response was received from the upstream server/iu,
  /\bbad gateway\b/iu,
  /\bservice unavailable\b/iu,
  /\bgateway timeout\b/iu,
  /\bgateway lost the response\b/iu,
  /\bfetch failed\b/iu,
  /\bfailed to pipe response\b/iu,
  /\beconnreset\b/iu,
  /\bconnection reset\b/iu,
  /\betimedout\b/iu,
  /\bsocket hang up\b/iu,
  /\bcircuit breaker is open\b/iu
]

const NON_TRANSIENT_SYNC_DIAGNOSIS_PATTERN =
  /invalid signature|permission denied|access denied|unauthorized|forbidden|invalid jwt|jwt expired|row-level security|schema cache|does not exist|violates|syntax error|duplicate key|null value in column|foreign key|unique constraint|check constraint|authentication|not found|status code 4\d\d|cannot read properties|is not a function|is not defined|unexpected token/iu

const ACTIONABLE_CAUSE_KEYS = [
  'isAppError',
  'isPermanent',
  'sqlState',
  'constraint',
  'table',
  'column',
  'schema',
  'routine',
  'severity'
] as const

const DIAGNOSIS_TEXT_KEYS = [
  'message',
  'details',
  'hint',
  'reason',
  'statusText'
] as const

const PLAIN_CAUSE_KEYS = new Set<string>([
  ...DIAGNOSIS_TEXT_KEYS,
  'code',
  'name',
  'cause',
  'status',
  'statusCode'
])

const MAX_CAUSE_DEPTH = 8

type CauseNodeVerdict = 'actionable' | 'transient' | 'neutral'

function isPlainCauseObject(value: object): boolean {
  if (Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * Classifies one node of an error's `.cause` chain. `actionable` means the node
 * carries metadata or a shape that must be reported; `neutral` is only reachable
 * for Error instances, which may wrap a transient cause without describing it.
 */
function classifyCauseNode(node: object): CauseNodeVerdict {
  const record = node as Record<string, unknown>
  const isErrorNode = node instanceof Error
  if (!isErrorNode) {
    if (
      !isPlainCauseObject(node) ||
      !Reflect.ownKeys(node).every(
        (key) => typeof key === 'string' && PLAIN_CAUSE_KEYS.has(key)
      )
    ) {
      return 'actionable'
    }
  }

  for (const key of ACTIONABLE_CAUSE_KEYS) {
    const value = record[key]
    if (value !== undefined && value !== false && value !== '') {
      return 'actionable'
    }
  }

  let transient = false

  for (const statusKey of ['status', 'statusCode'] as const) {
    const rawStatus = record[statusKey]
    if (rawStatus === undefined || rawStatus === 0) continue
    if (
      typeof rawStatus !== 'number' ||
      !Number.isInteger(rawStatus) ||
      !isTransientHttpStatus(rawStatus)
    ) {
      return 'actionable'
    }
    transient = true
  }

  const code = record.code
  if (code !== undefined && code !== '') {
    if (typeof code !== 'string' || !TRANSIENT_ERROR_CODES.has(code)) {
      return 'actionable'
    }
    transient = true
  }

  if (record.name !== undefined && typeof record.name !== 'string') {
    return 'actionable'
  }

  for (const textKey of DIAGNOSIS_TEXT_KEYS) {
    const value = record[textKey]
    if (value === undefined) continue
    if (
      typeof value !== 'string' ||
      NON_TRANSIENT_SYNC_DIAGNOSIS_PATTERN.test(value)
    ) {
      return 'actionable'
    }
    if (value === '') continue
    if (
      TRANSIENT_SYNC_MESSAGE_PATTERNS.some((pattern) => pattern.test(value))
    ) {
      transient = true
    } else if (!isErrorNode) {
      // A plain cause has no wrapper role, so unrecognized text is a diagnosis.
      return 'actionable'
    }
  }

  if (transient) return 'transient'
  return isErrorNode ? 'neutral' : 'actionable'
}

function hasVerifiedRemainingRetryBudget(job: SyncJob): boolean {
  if (
    typeof job.claimAttempts !== 'number' ||
    !Number.isSafeInteger(job.claimAttempts) ||
    job.claimAttempts < 1 ||
    typeof job.claimMaxAttempts !== 'number' ||
    !Number.isSafeInteger(job.claimMaxAttempts) ||
    job.claimMaxAttempts < 1
  ) {
    return false
  }
  return job.claimAttempts < job.claimMaxAttempts
}

function isTransientSyncLifecycleError(error: unknown): boolean {
  let current: unknown = error
  const seen = new Set<unknown>()
  let sawTransientIndicator = false

  try {
    while (current !== undefined && current !== null) {
      if (
        typeof current !== 'object' ||
        seen.has(current) ||
        seen.size >= MAX_CAUSE_DEPTH
      ) {
        return false
      }
      seen.add(current)

      const verdict = classifyCauseNode(current)
      if (verdict === 'actionable') return false
      if (verdict === 'transient') {
        sawTransientIndicator = true
      } else if (sawTransientIndicator) {
        // A cause that does not itself verify as transient explains the failure.
        return false
      }

      current = (current as { cause?: unknown }).cause
    }
  } catch {
    // A cause that cannot be inspected is never proven transient.
    return false
  }

  return sawTransientIndicator
}

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
    const originalError = Object.assign(
      new Error(
        `Failed to mark job complete: ${error.message ?? 'Unknown error'}`,
        { cause: error }
      ),
      typeof status === 'number' ? { status } : {}
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

  const { data: failRecorded, error: failError } = await callRpc<boolean>(
    supabase,
    'fail_job',
    {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_error: errorMessage,
      p_progress: {
        records_processed: result.recordsProcessed,
        players_updated: result.playersUpdated,
        ...(result.phaseMs !== undefined && { phase_ms: result.phaseMs }),
        ...(currentProviderMetrics() ?? {})
      }
    }
  )
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

  if (
    !failError &&
    failRecorded === true &&
    hasVerifiedRemainingRetryBudget(job) &&
    isTransientSyncLifecycleError(error)
  ) {
    logger.warn(
      {
        err: error,
        workerId,
        jobId: job.id,
        attempt: job.claimAttempts,
        maxAttempts: job.claimMaxAttempts
      },
      'Sync job attempt failed transiently; queued for retry'
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

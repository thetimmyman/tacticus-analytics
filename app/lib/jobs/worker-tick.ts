// Claims and dispatches jobs until `deadlineMs` minus a margin, so the response beats the CronJob deadline.

import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { callRpc } from '@/app/lib/sync/worker-utils'
import { getJobHandler } from './dispatcher'
import { buildWorkerId } from './worker-identity'
import type {
  JobHandlerContext,
  WorkQueueClass,
  WorkQueueJob,
  WorkerTickResult
} from './types'
import { sleep } from '@/app/lib/utils/async-timeout'

const logger = createComponentLogger('lib.jobs.worker-tick')

const SAFETY_MARGIN_MS = 5_000
const IDLE_POLL_MS = 1_000
export const WORKER_SETTLEMENT_TIMEOUT_MS = 4_000
export const STUCK_WORK_JOB_TIMEOUT_SECONDS = 600

// Idle ticks exit early: holding the pod would skip the next CronJob fire (concurrencyPolicy: Forbid).
const MAX_CONSECUTIVE_IDLE_POLLS = 3

export interface WorkerTickOptions {
  classes: WorkQueueClass[]
  deadlineMs: number
  signal?: AbortSignal
  reapStuckJobs?: boolean
}

export async function runWorkerTick(
  opts: WorkerTickOptions
): Promise<WorkerTickResult> {
  const start = Date.now()
  const workerId = buildWorkerId()
  const supabase = serviceDb(opts.signal)
  const result: WorkerTickResult = {
    workerId,
    classes: opts.classes,
    jobsProcessed: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    durationMs: 0,
    details: []
  }

  let consecutiveIdlePolls = 0

  if (opts.reapStuckJobs) {
    await driveStuckJobReaper(supabase, workerId, opts.signal)
  }

  // Shared with handlers so a job claimed near the end winds down with the tick.
  const softDeadlineAt = start + opts.deadlineMs - SAFETY_MARGIN_MS

  while (Date.now() - start < opts.deadlineMs - SAFETY_MARGIN_MS) {
    throwIfAborted(opts.signal)
    let claimResult
    try {
      claimResult = await callRpc<WorkQueueJob[] | WorkQueueJob | null>(
        supabase,
        'claim_next_work_job',
        {
          p_worker_id: workerId,
          p_classes: opts.classes
        }
      )
    } catch (error) {
      throwIfAborted(opts.signal)
      throw error
    }
    const { data, error } = claimResult

    if (error) {
      // Ambiguous ownership after an abort; the stuck-job reaper recovers it.
      throwIfAborted(opts.signal)
      result.error = error.message ?? 'claim_next_work_job failed'
      logger.error(
        { err: error, workerId, classes: opts.classes },
        'claim_next_work_job failed'
      )
      break
    }

    const rows = Array.isArray(data) ? data : data ? [data] : []
    const job = rows[0]
    if (!job) {
      throwIfAborted(opts.signal)
      consecutiveIdlePolls++
      if (consecutiveIdlePolls >= MAX_CONSECUTIVE_IDLE_POLLS) break
      if (
        Date.now() - start >=
        opts.deadlineMs - SAFETY_MARGIN_MS - IDLE_POLL_MS
      )
        break
      await sleepWithSignal(IDLE_POLL_MS, opts.signal)
      continue
    }

    consecutiveIdlePolls = 0
    result.jobsProcessed++
    await processClaimedJob(
      supabase,
      job,
      workerId,
      softDeadlineAt,
      result,
      opts.signal
    )
  }

  result.durationMs = Date.now() - start
  return result
}

async function driveStuckJobReaper(
  supabase: ReturnType<typeof serviceDb>,
  workerId: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    const { data: reaped, error } = await callRpc<number>(
      supabase,
      'reap_stuck_work_jobs',
      { p_timeout_seconds: STUCK_WORK_JOB_TIMEOUT_SECONDS }
    )
    throwIfAborted(signal)
    if (error) {
      logger.error({ err: error, workerId }, 'reap_stuck_work_jobs rpc failed')
      return
    }
    if ((reaped ?? 0) > 0) {
      logger.warn(
        { workerId, jobsReaped: reaped },
        'reaped stuck work_queue claims before verify tick'
      )
    }
  } catch (error) {
    throwIfAborted(signal)
    logger.error({ err: error, workerId }, 'reap_stuck_work_jobs rpc failed')
  }
}

async function processClaimedJob(
  supabase: ReturnType<typeof serviceDb>,
  job: WorkQueueJob,
  workerId: string,
  softDeadlineAt: number,
  result: WorkerTickResult,
  signal?: AbortSignal
): Promise<void> {
  const handler = getJobHandler(job.job_type)
  if (!handler) {
    const settled = await finishJobWithError(
      supabase,
      job,
      workerId,
      `no handler registered for job_type=${job.job_type}`,
      60,
      Boolean(signal)
    )
    result.jobsFailed++
    result.details.push({
      id: job.id,
      job_type: job.job_type,
      status: 'failed',
      error: settled ? 'no handler' : 'no handler; fail_work_job did not settle'
    })
    return
  }

  const ctx: JobHandlerContext = {
    jobId: job.id,
    workerId,
    attempts: job.attempts,
    softDeadlineAt,
    signal
  }

  try {
    throwIfAborted(signal)
    const handlerResult = (await handler(job.payload ?? {}, ctx)) ?? {}
    const { data: completed, error: completeError } = await callSettlementRpc(
      supabase,
      Boolean(signal),
      (settlementClient) =>
        callRpc<boolean>(settlementClient, 'complete_work_job', {
          p_job_id: job.id,
          p_worker_id: workerId,
          p_result: handlerResult
        })
    )
    if (completeError || completed !== true) {
      const message =
        completeError?.message ?? 'complete_work_job returned false'
      logger.error(
        { err: completeError, jobId: job.id },
        'complete_work_job rpc failed'
      )
      result.jobsFailed++
      result.details.push({
        id: job.id,
        job_type: job.job_type,
        status: 'failed',
        error: message
      })
      return
    }
    result.jobsSucceeded++
    result.details.push({
      id: job.id,
      job_type: job.job_type,
      status: 'completed'
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const backoff = computeBackoffSeconds(job.attempts)
    const settled = await finishJobWithError(
      supabase,
      job,
      workerId,
      message,
      backoff,
      Boolean(signal)
    )
    result.jobsFailed++
    result.details.push({
      id: job.id,
      job_type: job.job_type,
      status: 'failed',
      error: settled ? message : `${message}; fail_work_job did not settle`
    })
  }
}

async function finishJobWithError(
  supabase: ReturnType<typeof serviceDb>,
  job: WorkQueueJob,
  workerId: string,
  error: string,
  backoffSeconds: number,
  useBoundedSettlement: boolean
): Promise<boolean> {
  const { data: failed, error: failError } = await callSettlementRpc(
    supabase,
    useBoundedSettlement,
    (settlementClient) =>
      callRpc<boolean>(settlementClient, 'fail_work_job', {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_error: error,
        p_backoff_seconds: backoffSeconds
      })
  )
  if (failError || failed !== true) {
    logger.error(
      { err: failError, jobId: job.id, cause: error },
      'fail_work_job rpc failed'
    )
    return false
  }
  return true
}

async function callSettlementRpc<T>(
  existingClient: ReturnType<typeof serviceDb>,
  useBoundedSettlement: boolean,
  operation: (
    settlementClient: ReturnType<typeof serviceDb>
  ) => Promise<{ data: T | null; error: { message?: string | null } | null }>
): Promise<{
  data: T | null
  error: { message?: string | null } | null
}> {
  if (!useBoundedSettlement) return operation(existingClient)

  // The claim client may already be aborted, so settle on a fresh, bounded
  // transport. A timed-out settlement is left for reap_stuck_work_jobs.
  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(
          `work_queue settlement timed out after ${WORKER_SETTLEMENT_TIMEOUT_MS}ms`
        )
      ),
    WORKER_SETTLEMENT_TIMEOUT_MS
  )
  timer.unref?.()
  try {
    return await operation(serviceDb(controller.signal))
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : String(error)
      }
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

async function sleepWithSignal(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) return sleep(ms)
  throwIfAborted(signal)

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('The operation was aborted.', 'AbortError')
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function computeBackoffSeconds(attempts: number): number {
  // claim_next_work_job already incremented attempts, so the first failure has attempts=1.
  const exponent = Math.max(0, attempts - 1)
  const secs = Math.pow(2, exponent)
  return Math.min(3600, secs)
}

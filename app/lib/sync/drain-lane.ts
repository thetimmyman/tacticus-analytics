// sync_queue drain as N claim lanes; parallel-safe via FOR UPDATE SKIP LOCKED. Each lane needs
// its own worker_id: complete_job()/fail_job() match on (job_id, worker_id).
import { createComponentLogger } from '@/app/lib/logging'
import { processJob } from './sync-worker-service'
import { deferSyncJob } from './sync-job-defer'
import { callRpc, parseSyncJob } from './worker-utils'
import type {
  ServiceSupabaseClient,
  SyncQueueClaimRow,
  WorkerResult
} from './worker-types'

const logger = createComponentLogger('api.sync.worker.drain')

type DrainLaneStop = 'queue_empty' | 'budget_exhausted' | 'claim_error'
type DrainLaneRole = 'any' | 'background_first'

// Background claim tiers, tried in order before an unfiltered claim; rare heavy
// jobs come first so a steady incremental stream cannot outrank a due full_sync.
const backgroundClaimTiers: ReadonlyArray<readonly string[]> = [
  ['validation_sync', 'full_sync', 'player_sync'],
  ['incremental_sync']
]
const guildsInFlight = new Set<string>()

export interface DrainLaneOutcome {
  laneIndex: number
  laneWorkerId: string
  role: DrainLaneRole
  results: WorkerResult[]
  jobsDrained: number
  jobsDeferred: number
  wallMs: number
  stoppedReason: DrainLaneStop
}

export interface QueueDepthSample {
  pendingDepth: number | null
  oldestPendingAgeSeconds: number | null
}

export interface DrainLaneOptions {
  supabase: ServiceSupabaseClient
  laneIndex: number
  laneWorkerId: string
  role?: DrainLaneRole
  startTime: number
  /** Per-lane budget in ms (WORKER_CONFIG.workerTimeout). */
  budgetMs: number
  /** Reserved tail of the budget in which a lane never STARTS a job. */
  tailReserveMs: number
  now?: () => number
}

export function laneWindowMs(budgetMs: number, tailReserveMs: number): number {
  return Math.max(0, budgetMs - tailReserveMs)
}

export function laneWorkerId(workerId: string, laneIndex: number): string {
  return `${workerId}-l${laneIndex}`
}

// Never throws: a dying lane must not take other lanes or the following housekeeping down.
export async function runDrainLane(
  options: DrainLaneOptions
): Promise<DrainLaneOutcome> {
  const {
    supabase,
    laneIndex,
    laneWorkerId: workerIdForLane,
    role = 'any',
    startTime,
    budgetMs,
    tailReserveMs
  } = options
  const now = options.now ?? (() => Date.now())

  const window = laneWindowMs(budgetMs, tailReserveMs)
  const results: WorkerResult[] = []
  let jobsDeferred = 0
  let stoppedReason: DrainLaneStop = 'budget_exhausted'

  while (now() - startTime < window) {
    let claimedJob: SyncQueueClaimRow | null = null
    let claimError: { message?: string | null } | null = null
    try {
      const tiers: ReadonlyArray<readonly string[] | undefined> =
        role === 'background_first'
          ? [...backgroundClaimTiers, undefined]
          : [undefined]
      for (const jobTypes of tiers) {
        const claim = await callRpc<SyncQueueClaimRow>(
          supabase,
          'claim_next_job',
          {
            p_worker_id: workerIdForLane,
            p_job_types: jobTypes ? [...jobTypes] : undefined
          }
        )
        claimedJob = claim.data
        claimError = claim.error
        if (claimError || parseSyncJob(claimedJob)) break
      }
    } catch (error) {
      claimError = { message: String(error) }
    }

    if (claimError) {
      logger.error(
        { err: claimError, laneIndex, workerId: workerIdForLane },
        'Drain lane failed to claim next job'
      )
      stoppedReason = 'claim_error'
      break
    }

    const typedJob = parseSyncJob(claimedJob)
    if (!typedJob) {
      stoppedReason = 'queue_empty'
      break
    }

    // Completion reconciliation must finish inside the lane window, not after it.
    typedJob.reconciliationDeadlineMs = startTime + window

    if (guildsInFlight.has(typedJob.guild_code)) {
      try {
        await deferSyncJob(typedJob, supabase, workerIdForLane, {
          delayMs: 30_000,
          reason: 'guild_in_flight'
        })
        jobsDeferred += 1
      } catch (error) {
        logger.error(
          { err: error, laneIndex, jobId: typedJob.id },
          'Failed to defer sync job'
        )
        // Release through fail_job's retry backoff rather than strand the claim until the stuck-job reset.
        await callRpc<boolean>(supabase, 'fail_job', {
          p_job_id: typedJob.id,
          p_worker_id: workerIdForLane,
          p_error: 'guild_in_flight deferral failed',
          p_progress: {}
        }).catch(() => undefined)
        stoppedReason = 'claim_error'
        break
      }
      continue
    }

    guildsInFlight.add(typedJob.guild_code)
    try {
      logger.info(
        {
          laneIndex,
          workerId: workerIdForLane,
          jobId: typedJob.id,
          guildCode: typedJob.guild_code
        },
        'Worker processing sync job'
      )
      results.push(await processJob(typedJob, supabase, workerIdForLane))
    } catch (error) {
      logger.error(
        { err: error, laneIndex, jobId: typedJob.id },
        'Drain lane failed to process job'
      )
      stoppedReason = 'claim_error'
      break
    } finally {
      guildsInFlight.delete(typedJob.guild_code)
    }
  }

  return {
    laneIndex,
    laneWorkerId: workerIdForLane,
    role,
    results,
    jobsDrained: results.length,
    jobsDeferred,
    wallMs: now() - startTime,
    stoppedReason
  }
}

const CLAIMABLE_AGE_SCAN_LIMIT = 250

function effectiveClaimableTimestampMs(row: {
  created_at?: unknown
  scheduled_for?: unknown
}): number | null {
  if (typeof row.created_at !== 'string') return null
  const createdAtMs = Date.parse(row.created_at)
  if (!Number.isFinite(createdAtMs)) return null

  if (typeof row.scheduled_for === 'string') {
    const scheduledForMs = Date.parse(row.scheduled_for)
    if (Number.isFinite(scheduledForMs)) {
      return Math.max(createdAtMs, scheduledForMs)
    }
  }

  return createdAtMs
}

// Best-effort and non-throwing; null means "not measured", not zero.
// Future-scheduled rows (scheduled_for > now) cannot be claimed yet, so both
// depth and age exclude them and age starts once scheduled_for is reached.
export async function readQueueDepth(
  supabase: ServiceSupabaseClient,
  now: () => number = () => Date.now()
): Promise<QueueDepthSample> {
  const sample: QueueDepthSample = {
    pendingDepth: null,
    oldestPendingAgeSeconds: null
  }
  const sampleTimeMs = now()
  const claimableFilter = `scheduled_for.is.null,scheduled_for.lte.${new Date(sampleTimeMs).toISOString()}`

  try {
    const countResult = (await supabase
      .from('sync_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .or(claimableFilter)) as { count?: unknown } | null

    if (countResult && typeof countResult.count === 'number') {
      sample.pendingDepth = countResult.count
    }
  } catch (error) {
    logger.warn({ err: error }, 'Could not sample sync_queue depth')
  }

  try {
    const oldestResult = (await supabase
      .from('sync_queue')
      .select('created_at, scheduled_for')
      .eq('status', 'pending')
      .or(claimableFilter)
      .order('scheduled_for', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(CLAIMABLE_AGE_SCAN_LIMIT)) as { data?: unknown } | null

    const rows = oldestResult?.data
    if (Array.isArray(rows) && rows.length > 0) {
      let oldestClaimableMs: number | null = null
      for (const row of rows) {
        const claimableMs = effectiveClaimableTimestampMs(
          row as { created_at?: unknown; scheduled_for?: unknown }
        )
        if (
          claimableMs !== null &&
          (oldestClaimableMs === null || claimableMs < oldestClaimableMs)
        ) {
          oldestClaimableMs = claimableMs
        }
      }
      if (oldestClaimableMs !== null) {
        sample.oldestPendingAgeSeconds = Math.max(
          0,
          Math.round((sampleTimeMs - oldestClaimableMs) / 1000)
        )
      }
    }
  } catch (error) {
    logger.warn(
      { err: error },
      'Could not sample oldest pending sync_queue row'
    )
  }

  return sample
}

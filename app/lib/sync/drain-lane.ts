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

// Best-effort and non-throwing; null means "not measured", not zero.
export async function readQueueDepth(
  supabase: ServiceSupabaseClient
): Promise<QueueDepthSample> {
  const sample: QueueDepthSample = {
    pendingDepth: null,
    oldestPendingAgeSeconds: null
  }

  try {
    const countResult = (await supabase
      .from('sync_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')) as { count?: unknown } | null

    if (countResult && typeof countResult.count === 'number') {
      sample.pendingDepth = countResult.count
    }
  } catch (error) {
    logger.warn({ err: error }, 'Could not sample sync_queue depth')
  }

  try {
    const oldestResult = (await supabase
      .from('sync_queue')
      .select('created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)) as { data?: unknown } | null

    const rows = oldestResult?.data
    if (Array.isArray(rows) && rows.length > 0) {
      const createdAt = (rows[0] as { created_at?: unknown }).created_at
      if (typeof createdAt === 'string') {
        const parsed = Date.parse(createdAt)
        if (Number.isFinite(parsed)) {
          sample.oldestPendingAgeSeconds = Math.max(
            0,
            Math.round((Date.now() - parsed) / 1000)
          )
        }
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

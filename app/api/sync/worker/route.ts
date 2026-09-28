import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.sync.worker')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  laneWindowMs,
  laneWorkerId,
  readQueueDepth,
  runDrainLane
} from '@/app/lib/sync/drain-lane'
import { requireCronAuthorization, callRpc } from '@/app/lib/sync/worker-utils'
import {
  WORKER_CONFIG,
  resolveDrainLanes,
  type WorkerResult
} from '@/app/lib/sync/worker-types'
import { generateId } from '@/app/lib/utils/id-generation'

/** Drains sync_queue across lanes; claim_next_job() uses FOR UPDATE SKIP LOCKED, so lanes never share a job. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  requireCronAuthorization(req)

  const startTime = Date.now()
  const workerId = generateId('w', 9)

  try {
    const supabase = serviceDb()

    const lanes = resolveDrainLanes()
    const budgetMs = WORKER_CONFIG.workerTimeout
    const tailReserveMs = WORKER_CONFIG.laneTailReserveMs
    const windowMs = laneWindowMs(budgetMs, tailReserveMs)

    const depth = await readQueueDepth(supabase)

    const outcomes = await Promise.all(
      Array.from({ length: lanes }, (_unused, laneIndex) =>
        runDrainLane({
          supabase,
          laneIndex,
          role:
            lanes >= 2 && laneIndex === lanes - 1 ? 'background_first' : 'any',
          laneWorkerId: laneWorkerId(workerId, laneIndex),
          startTime,
          budgetMs,
          tailReserveMs
        })
      )
    )

    const results: WorkerResult[] = outcomes.flatMap(
      (outcome) => outcome.results
    )
    const duration = Date.now() - startTime
    const saturated = outcomes.some(
      (outcome) => outcome.stoppedReason === 'budget_exhausted'
    )

    const { error: resetError } = await callRpc<unknown>(
      supabase,
      'reset_stuck_jobs'
    )
    if (resetError)
      logger.warn(
        `[Worker ${workerId}] Failed to reset stuck jobs: ${resetError.message ?? 'Unknown error'}`
      )
    const { error: cleanupError } = await callRpc<number>(
      supabase,
      'cleanup_old_sync_data'
    )
    if (cleanupError)
      logger.warn(
        `[Worker ${workerId}] Failed to cleanup old sync data: ${cleanupError.message ?? 'Unknown error'}`
      )

    const perLane = outcomes.map((outcome) => ({
      lane: outcome.laneIndex,
      workerId: outcome.laneWorkerId,
      role: outcome.role,
      jobsDrained: outcome.jobsDrained,
      jobsDeferred: outcome.jobsDeferred,
      wallMs: outcome.wallMs,
      stoppedReason: outcome.stoppedReason
    }))

    logger.info(
      {
        workerId,
        lanes,
        budgetMs,
        windowMs,
        durationMs: duration,
        saturated,
        queueDepthStart: depth.pendingDepth,
        oldestPendingAgeSecondsStart: depth.oldestPendingAgeSeconds,
        jobsDrained: results.length,
        perLane
      },
      'sync_queue drain run complete'
    )

    // Recorded last so a metrics failure cannot cost a drained job.
    const { error: metricsError } = await callRpc<string>(
      supabase,
      'record_sync_drain_run',
      {
        p_worker_id: workerId,
        p_lanes: lanes,
        p_budget_ms: budgetMs,
        p_window_ms: windowMs,
        p_duration_ms: duration,
        p_jobs_drained: results.length,
        p_queue_depth_start: depth.pendingDepth,
        p_oldest_pending_age_seconds: depth.oldestPendingAgeSeconds,
        p_saturated: saturated,
        p_per_lane: perLane
      }
    )
    if (metricsError)
      logger.warn(
        `[Worker ${workerId}] Failed to record drain run metrics: ${metricsError.message ?? 'Unknown error'}`
      )

    return NextResponse.json({
      success: true,
      workerId,
      lanes,
      budgetMs,
      windowMs,
      saturated,
      queueDepthStart: depth.pendingDepth,
      oldestPendingAgeSecondsStart: depth.oldestPendingAgeSeconds,
      jobsProcessed: results.length,
      totalRecords: results.reduce((sum, r) => sum + r.recordsProcessed, 0),
      duration,
      perLane,
      results
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, `[Worker ${workerId}] Fatal error:`)
    throw Errors.fromResponse(500, {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/** Cron-secret gated: the payload is per-guild operational data read with the service role. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  requireCronAuthorization(req)

  const supabase = serviceDb()

  const { data: stats, error: statsError } = await callRpc<unknown[]>(
    supabase,
    'get_queue_stats'
  )
  // sync_health stays clean even when the roster writer is dead, so check roster-write recency.
  const { data: rosterHealth, error: rosterError } = await callRpc<
    Array<{ verdict: string }>
  >(supabase, 'guild_roster_write_health')

  const { data: health, error: healthError } = await supabase
    .from('sync_health' as unknown as 'sync_health')
    .select(
      'id, guild_code, last_successful_sync, last_failed_sync, consecutive_failures, total_syncs, success_rate, avg_sync_time_ms, data_completeness, data_freshness_hours, missing_players, duplicate_battles, last_roster_write_at, roster_rows_written_last_pass, roster_write_failures, health_status, updated_at'
    )
    .order('health_status' as unknown as 'health_status', { ascending: false })
    .limit(10)

  const rosterAlerting = (rosterHealth ?? []).filter(
    (row) => row.verdict !== 'ok'
  )

  const degraded = Boolean(statsError || healthError || rosterError)
  if (degraded) {
    logger.warn(
      {
        statsError: statsError?.message ?? null,
        healthError: healthError?.message ?? null,
        rosterError: rosterError?.message ?? null
      },
      'Sync worker health check could not read queue stats, sync_health or roster-write health'
    )
  }

  // Always 200: withErrorHandler rewrites >=400 into its error envelope.
  return NextResponse.json({
    status: degraded ? 'degraded' : 'healthy',
    timestamp: new Date().toISOString(),
    queue: stats || [],
    health: health || [],
    roster_write: {
      guilds_measured: (rosterHealth ?? []).length,
      alerting: rosterAlerting
    },
    ...(degraded
      ? {
          errors: {
            queue: statsError?.message ?? null,
            health: healthError?.message ?? null,
            roster_write: rosterError?.message ?? null
          }
        }
      : {})
  })
})

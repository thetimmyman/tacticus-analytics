import { createComponentLogger } from '@/app/lib/logging'
import { TimeoutError } from '@/app/lib/utils/async-timeout'
import { runWorkerTick } from './worker-tick'
import type { WorkerTickResult } from './types'

import './register-hooks-handlers'

const logger = createComponentLogger('lib.jobs.verify-worker-scheduler')

export const VERIFY_WORKER_INTERVAL_MS = 60_000
export const VERIFY_WORKER_DEADLINE_MS = 50_000
export const VERIFY_WORKER_HARD_TIMEOUT_MS = 55_000

type RunVerifyTick = (signal: AbortSignal) => Promise<WorkerTickResult>

export interface VerifyWorkerSchedulerStatus {
  running: boolean
  startedAt: string | null
  lastStartedAt: string | null
  lastCompletedAt: string | null
  timedOutAt: string | null
  drainingAfterTimeout: boolean
  lastError: string | null
}

export function createVerifyWorkerScheduler(
  runVerifyTick: RunVerifyTick = (signal) =>
    runWorkerTick({
      classes: ['verify'],
      deadlineMs: VERIFY_WORKER_DEADLINE_MS,
      signal,
      reapStuckJobs: true
    })
) {
  let intervalTimer: ReturnType<typeof setInterval> | null = null
  let activeController: AbortController | null = null
  let running = false
  let startedAt: string | null = null
  let lastStartedAt: string | null = null
  let lastCompletedAt: string | null = null
  let timedOutAt: string | null = null
  let drainingAfterTimeout = false
  let lastError: string | null = null

  async function tick(): Promise<void> {
    if (running) return

    running = true
    lastStartedAt = new Date().toISOString()
    const controller = new AbortController()
    activeController = controller
    let timeoutError: TimeoutError | null = null
    // Keep `running` until the aborted work fully unwinds, or the next interval overlaps it.
    const hardTimeout = setTimeout(() => {
      timeoutError = new TimeoutError(
        `scheduled verify worker tick timed out after ${VERIFY_WORKER_HARD_TIMEOUT_MS}ms`,
        VERIFY_WORKER_HARD_TIMEOUT_MS
      )
      timedOutAt = new Date().toISOString()
      drainingAfterTimeout = true
      lastError = timeoutError.message
      controller.abort(timeoutError)
      logger.error(
        { err: timeoutError },
        '[verify-worker] scheduled tick timed out; awaiting settlement'
      )
    }, VERIFY_WORKER_HARD_TIMEOUT_MS)
    hardTimeout.unref?.()

    try {
      const result = await runVerifyTick(controller.signal)
      if (!timeoutError) lastError = result.error ?? failureSummary(result)
      if (result.jobsProcessed > 0) {
        logger.info(
          {
            workerId: result.workerId,
            jobsProcessed: result.jobsProcessed,
            jobsSucceeded: result.jobsSucceeded,
            jobsFailed: result.jobsFailed,
            durationMs: result.durationMs
          },
          '[verify-worker] scheduled tick complete'
        )
      }
    } catch (error) {
      if (!timeoutError) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      logger.error({ err: error }, '[verify-worker] scheduled tick failed')
    } finally {
      clearTimeout(hardTimeout)
      activeController = null
      drainingAfterTimeout = false
      running = false
      lastCompletedAt = new Date().toISOString()
    }
  }

  return {
    start(): boolean {
      if (intervalTimer) return false

      startedAt = new Date().toISOString()
      void tick()
      intervalTimer = setInterval(() => void tick(), VERIFY_WORKER_INTERVAL_MS)
      intervalTimer.unref()
      return true
    },

    stop(): void {
      if (!intervalTimer) return
      clearInterval(intervalTimer)
      intervalTimer = null
      activeController?.abort(new Error('scheduled verify worker stopped'))
    },

    status(): VerifyWorkerSchedulerStatus {
      return {
        running,
        startedAt,
        lastStartedAt,
        lastCompletedAt,
        timedOutAt,
        drainingAfterTimeout,
        lastError
      }
    }
  }
}

function failureSummary(result: WorkerTickResult): string | null {
  if (result.jobsFailed === 0) return null
  const failures = result.details
    .filter((detail) => detail.status === 'failed')
    .map((detail) => detail.error)
    .filter((error): error is string => Boolean(error))
  const suffix = failures.length > 0 ? `: ${failures.join('; ')}` : ''
  return `${result.jobsFailed} verify job(s) failed${suffix}`
}

type VerifyWorkerScheduler = ReturnType<typeof createVerifyWorkerScheduler>
const VERIFY_WORKER_SCHEDULER_SYMBOL = Symbol.for(
  'tacticus.verify-worker-scheduler'
)

function runtimeScheduler(): VerifyWorkerScheduler {
  const runtime = globalThis as typeof globalThis & {
    [key: symbol]: VerifyWorkerScheduler | undefined
  }
  return (runtime[VERIFY_WORKER_SCHEDULER_SYMBOL] ??=
    createVerifyWorkerScheduler())
}

export function startVerifyWorkerScheduler(): boolean {
  return runtimeScheduler().start()
}

export function getVerifyWorkerSchedulerStatus(): VerifyWorkerSchedulerStatus {
  return runtimeScheduler().status()
}

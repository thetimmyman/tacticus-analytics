import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createVerifyWorkerScheduler,
  getVerifyWorkerSchedulerStatus,
  VERIFY_WORKER_HARD_TIMEOUT_MS,
  VERIFY_WORKER_INTERVAL_MS
} from '@/app/lib/jobs/verify-worker-scheduler'
import type { WorkerTickResult } from '@/app/lib/jobs/types'

const emptyResult: WorkerTickResult = {
  workerId: 'test-worker',
  classes: ['verify'],
  jobsProcessed: 0,
  jobsSucceeded: 0,
  jobsFailed: 0,
  durationMs: 1,
  details: []
}

describe('verify worker scheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts immediately, repeats each minute, and is idempotent', async () => {
    const runTick = vi.fn().mockResolvedValue(emptyResult)
    const scheduler = createVerifyWorkerScheduler(runTick)

    expect(scheduler.start()).toBe(true)
    expect(scheduler.start()).toBe(false)
    await vi.runAllTicks()
    expect(runTick).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(VERIFY_WORKER_INTERVAL_MS)
    expect(runTick).toHaveBeenCalledTimes(2)
    expect(scheduler.status()).toMatchObject({
      running: false,
      lastError: null
    })

    scheduler.stop()
  })

  it('aborts a stuck tick and starts the next interval with max-active=1 after settlement', async () => {
    let active = 0
    let maxActive = 0
    const runTick = vi
      .fn<RunTick>()
      .mockImplementationOnce(
        (signal) =>
          new Promise<WorkerTickResult>((_resolve, reject) => {
            active++
            maxActive = Math.max(maxActive, active)
            signal.addEventListener(
              'abort',
              () => {
                active--
                reject(signal.reason)
              },
              { once: true }
            )
          })
      )
      .mockImplementationOnce(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        active--
        return emptyResult
      })
    const scheduler = createVerifyWorkerScheduler(runTick)

    scheduler.start()
    await vi.advanceTimersByTimeAsync(VERIFY_WORKER_HARD_TIMEOUT_MS)
    expect(runTick).toHaveBeenCalledTimes(1)
    expect(scheduler.status()).toMatchObject({
      running: false,
      drainingAfterTimeout: false,
      timedOutAt: expect.any(String),
      lastError: expect.stringContaining('timed out')
    })

    await vi.advanceTimersByTimeAsync(
      VERIFY_WORKER_INTERVAL_MS - VERIFY_WORKER_HARD_TIMEOUT_MS
    )
    expect(runTick).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
    scheduler.stop()
  })

  it('keeps the guard held across intervals until abort cleanup really settles', async () => {
    let releaseCleanup: (() => void) | undefined
    let active = 0
    let maxActive = 0
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const runTick = vi
      .fn<RunTick>()
      .mockImplementationOnce(async (signal) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        )
        await cleanup
        active--
        throw signal.reason
      })
      .mockImplementationOnce(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        active--
        return emptyResult
      })
    const scheduler = createVerifyWorkerScheduler(runTick)

    scheduler.start()
    await vi.advanceTimersByTimeAsync(VERIFY_WORKER_HARD_TIMEOUT_MS)
    expect(scheduler.status()).toMatchObject({
      running: true,
      drainingAfterTimeout: true,
      lastCompletedAt: null,
      lastError: expect.stringContaining('timed out')
    })

    await vi.advanceTimersByTimeAsync(
      VERIFY_WORKER_INTERVAL_MS * 3 - VERIFY_WORKER_HARD_TIMEOUT_MS
    )
    expect(runTick).toHaveBeenCalledTimes(1)
    expect(maxActive).toBe(1)
    expect(scheduler.status().lastCompletedAt).toBeNull()

    releaseCleanup?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(scheduler.status()).toMatchObject({
      running: false,
      drainingAfterTimeout: false,
      lastCompletedAt: expect.any(String),
      lastError: expect.stringContaining('timed out')
    })

    await vi.advanceTimersByTimeAsync(VERIFY_WORKER_INTERVAL_MS)
    expect(runTick).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
    scheduler.stop()
  })

  it('records resolved worker and claim failures', async () => {
    const failedResult: WorkerTickResult = {
      ...emptyResult,
      jobsProcessed: 1,
      jobsFailed: 1,
      details: [
        {
          id: 7,
          job_type: 'user-ban-reconcile',
          status: 'failed',
          error: 'provider unavailable'
        }
      ]
    }
    const runTick = vi
      .fn<RunTick>()
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce({
        ...emptyResult,
        error: 'claim_next_work_job failed'
      })
    const scheduler = createVerifyWorkerScheduler(runTick)

    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(scheduler.status()).toMatchObject({
      running: false,
      lastError: expect.stringContaining('provider unavailable')
    })

    await vi.advanceTimersByTimeAsync(VERIFY_WORKER_INTERVAL_MS)
    expect(scheduler.status().lastError).toBe('claim_next_work_job failed')

    scheduler.stop()
  })

  it('shares the runtime scheduler across separately loaded server bundles', async () => {
    const key = Symbol.for('tacticus.verify-worker-scheduler')
    const runtime = globalThis as typeof globalThis & {
      [key: symbol]: unknown
    }
    delete runtime[key]

    expect(getVerifyWorkerSchedulerStatus().startedAt).toBeNull()
    const firstBundleScheduler = runtime[key]
    expect(firstBundleScheduler).toBeDefined()

    vi.resetModules()
    const separatelyLoadedModule =
      await import('@/app/lib/jobs/verify-worker-scheduler')
    expect(
      separatelyLoadedModule.getVerifyWorkerSchedulerStatus().startedAt
    ).toBeNull()
    expect(runtime[key]).toBe(firstBundleScheduler)

    delete runtime[key]
  })
})

type RunTick = (signal: AbortSignal) => Promise<WorkerTickResult>

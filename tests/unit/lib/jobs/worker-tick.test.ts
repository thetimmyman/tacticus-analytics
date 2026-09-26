import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => ({
  serviceDb: vi.fn((signal?: AbortSignal) => ({ signal }))
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: dbMocks.serviceDb
}))

const callRpcMock = vi.fn()
vi.mock('@/app/lib/sync/worker-utils', () => ({
  callRpc: (...args: unknown[]) => callRpcMock(...args)
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

import {
  runWorkerTick,
  STUCK_WORK_JOB_TIMEOUT_SECONDS,
  WORKER_SETTLEMENT_TIMEOUT_MS
} from '@/app/lib/jobs/worker-tick'
import { registerJobHandler } from '@/app/lib/jobs/dispatcher'

describe('runWorkerTick — idle-exit behavior (B)', () => {
  beforeEach(() => {
    callRpcMock.mockReset()
    dbMocks.serviceDb.mockClear()
    dbMocks.serviceDb.mockImplementation((signal?: AbortSignal) => ({ signal }))
  })
  afterEach(() => {
    callRpcMock.mockReset()
    vi.useRealTimers()
  })

  it('exits within ~3 idle polls when no work is available, well under the deadline', async () => {
    callRpcMock.mockResolvedValue({ data: null, error: null })

    const start = Date.now()
    const result = await runWorkerTick({
      classes: ['batch'],
      deadlineMs: 240_000
    })
    const elapsed = Date.now() - start

    // Generous bound for CI jitter; still proves no busy-poll to the deadline.
    expect(elapsed).toBeLessThan(5_000)
    expect(result.jobsProcessed).toBe(0)
    expect(result.jobsSucceeded).toBe(0)
    expect(result.jobsFailed).toBe(0)

    expect(callRpcMock).toHaveBeenCalledTimes(3)
  }, 10_000)

  it('keeps draining the queue when work is available — counter resets on a successful claim', async () => {
    // A claim must reset the idle counter, or one job then one idle poll would exit immediately.
    let returned = false
    callRpcMock.mockImplementation(async (_supabase, fn: string) => {
      if (fn === 'claim_next_work_job') {
        if (!returned) {
          returned = true
          return {
            data: {
              id: 1,
              job_type: 'noop-handler',
              job_class: 'batch',
              payload: {},
              dedupe_key: 'k1',
              status: 'processing',
              priority: 5,
              attempts: 1,
              max_attempts: 3,
              claimed_by: 'test-worker',
              claimed_at: new Date().toISOString(),
              scheduled_for: new Date().toISOString(),
              started_at: new Date().toISOString(),
              completed_at: null,
              error: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            error: null
          }
        }
        return { data: null, error: null }
      }
      return { data: true, error: null }
    })

    try {
      registerJobHandler('noop-handler', async () => ({}))
    } catch {
      // already registered — fine
    }

    const start = Date.now()
    const result = await runWorkerTick({
      classes: ['batch'],
      deadlineMs: 240_000
    })
    const elapsed = Date.now() - start

    expect(result.jobsProcessed).toBe(1)
    expect(result.jobsSucceeded).toBe(1)
    expect(result.jobsFailed).toBe(0)
    expect(elapsed).toBeLessThan(5_000)
  }, 10_000)

  it('reports claim failures in the resolved tick result', async () => {
    callRpcMock.mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' }
    })

    const result = await runWorkerTick({
      classes: ['verify'],
      deadlineMs: 50_000
    })

    expect(result).toMatchObject({
      jobsProcessed: 0,
      jobsFailed: 0,
      error: 'database unavailable'
    })
  })

  it('drives bounded-age stuck-claim recovery before a verify claim loop', async () => {
    vi.useFakeTimers()
    callRpcMock.mockImplementation(
      async (_client, fn: string, args: unknown) => {
        if (fn === 'reap_stuck_work_jobs') {
          expect(args).toEqual({
            p_timeout_seconds: STUCK_WORK_JOB_TIMEOUT_SECONDS
          })
          return { data: 1, error: null }
        }
        expect(fn).toBe('claim_next_work_job')
        return { data: null, error: null }
      }
    )

    const operation = runWorkerTick({
      classes: ['verify'],
      deadlineMs: 50_000,
      reapStuckJobs: true
    })
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(operation).resolves.toMatchObject({ jobsProcessed: 0 })

    expect(callRpcMock.mock.calls[0]?.[1]).toBe('reap_stuck_work_jobs')
    expect(
      callRpcMock.mock.calls.filter(([, fn]) => fn === 'claim_next_work_job')
    ).toHaveLength(3)
  })

  it('propagates abort to the claim and handler but settles a known claim through a fresh client', async () => {
    const controller = new AbortController()
    const job = workQueueJob(31, 'abort-propagation-handler', 1)
    let capturedHandlerSignal: AbortSignal | undefined
    let settlementWasAbortable = false
    let returned = false

    try {
      registerJobHandler('abort-propagation-handler', async (_payload, ctx) => {
        capturedHandlerSignal = ctx.signal
        controller.abort(new Error('verify tick hard timeout'))
        throw controller.signal.reason
      })
    } catch {
      // already registered by another test module load
    }

    callRpcMock.mockImplementation(
      async (client: { signal?: AbortSignal }, fn: string, args: unknown) => {
        if (fn === 'claim_next_work_job' && !returned) {
          returned = true
          return { data: job, error: null }
        }
        if (fn === 'fail_work_job') {
          settlementWasAbortable = Boolean(
            client.signal &&
            client.signal !== controller.signal &&
            !client.signal.aborted
          )
          expect(args).toMatchObject({
            p_job_id: 31,
            p_error: 'verify tick hard timeout',
            p_backoff_seconds: 1
          })
          return { data: true, error: null }
        }
        return { data: null, error: null }
      }
    )

    await expect(
      runWorkerTick({
        classes: ['verify'],
        deadlineMs: 50_000,
        signal: controller.signal
      })
    ).rejects.toThrow('verify tick hard timeout')

    expect(dbMocks.serviceDb).toHaveBeenNthCalledWith(1, controller.signal)
    expect(dbMocks.serviceDb).toHaveBeenCalledTimes(2)
    expect(capturedHandlerSignal).toBe(controller.signal)
    expect(settlementWasAbortable).toBe(true)
    expect(job.payload).toEqual({ marker: 'unchanged' })
    expect(
      callRpcMock.mock.calls.filter(([, fn]) => fn === 'complete_work_job')
    ).toHaveLength(0)
  })

  it('does not dispatch or settle when an aborted claim has ambiguous ownership', async () => {
    const controller = new AbortController()
    const handler = vi.fn(async () => ({}))
    try {
      registerJobHandler('ambiguous-claim-handler', handler)
    } catch {
      // already registered by another test module load
    }
    callRpcMock.mockImplementation(async (_client, fn: string) => {
      expect(fn).toBe('claim_next_work_job')
      controller.abort(new Error('claim response lost at timeout'))
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    await expect(
      runWorkerTick({
        classes: ['verify'],
        deadlineMs: 50_000,
        signal: controller.signal
      })
    ).rejects.toThrow('claim response lost at timeout')

    expect(handler).not.toHaveBeenCalled()
    expect(callRpcMock).toHaveBeenCalledTimes(1)
    expect(dbMocks.serviceDb).toHaveBeenCalledTimes(1)
  })

  it('settles a claim returned exactly as the transport aborts', async () => {
    const controller = new AbortController()
    const job = workQueueJob(33, 'abort-boundary-handler', 1)
    const handler = vi.fn(async () => ({}))
    try {
      registerJobHandler('abort-boundary-handler', handler)
    } catch {
      // already registered by another test module load
    }

    callRpcMock.mockImplementation(
      async (client: { signal?: AbortSignal }, fn: string, args: unknown) => {
        if (fn === 'claim_next_work_job') {
          controller.abort(new Error('claim returned at timeout boundary'))
          return { data: job, error: null }
        }
        expect(fn).toBe('fail_work_job')
        expect(client.signal).not.toBe(controller.signal)
        expect(args).toMatchObject({
          p_job_id: 33,
          p_worker_id: expect.any(String),
          p_error: 'claim returned at timeout boundary'
        })
        return { data: true, error: null }
      }
    )

    await expect(
      runWorkerTick({
        classes: ['verify'],
        deadlineMs: 50_000,
        signal: controller.signal
      })
    ).rejects.toThrow('claim returned at timeout boundary')

    expect(handler).not.toHaveBeenCalled()
    expect(
      callRpcMock.mock.calls.filter(([, fn]) => fn === 'fail_work_job')
    ).toHaveLength(1)
  })

  it('bounds known-claim failure settlement and reports the ambiguous row for reaping', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const job = workQueueJob(32, 'settlement-timeout-handler', 2)
    let returned = false
    try {
      registerJobHandler('settlement-timeout-handler', async () => {
        throw new Error('handler failed')
      })
    } catch {
      // already registered by another test module load
    }
    callRpcMock.mockImplementation(
      async (client: { signal?: AbortSignal }, fn: string) => {
        if (fn === 'claim_next_work_job' && !returned) {
          returned = true
          return { data: job, error: null }
        }
        if (fn === 'fail_work_job') {
          return new Promise((_resolve, reject) =>
            client.signal?.addEventListener(
              'abort',
              () => reject(client.signal?.reason),
              { once: true }
            )
          )
        }
        return { data: null, error: null }
      }
    )

    const operation = runWorkerTick({
      classes: ['verify'],
      deadlineMs: WORKER_SETTLEMENT_TIMEOUT_MS + 5_000,
      signal: controller.signal
    })
    await vi.advanceTimersByTimeAsync(WORKER_SETTLEMENT_TIMEOUT_MS)
    await expect(operation).resolves.toMatchObject({
      jobsProcessed: 1,
      jobsSucceeded: 0,
      jobsFailed: 1,
      details: [
        {
          id: 32,
          error: 'handler failed; fail_work_job did not settle'
        }
      ]
    })
  })

  // softDeadlineAt lets long handlers wind down before the k8s deadline kills the driver.
  it('passes ctx.softDeadlineAt ≈ start + deadlineMs - SAFETY_MARGIN to handlers', async () => {
    let captured: number | undefined
    let returned = false
    callRpcMock.mockImplementation(async (_supabase, fn: string) => {
      if (fn === 'claim_next_work_job') {
        if (!returned) {
          returned = true
          return {
            data: {
              id: 7,
              job_type: 'capture-deadline-handler',
              job_class: 'batch',
              payload: {},
              dedupe_key: 'k7',
              status: 'processing',
              priority: 5,
              attempts: 1,
              max_attempts: 3,
              claimed_by: 'test-worker',
              claimed_at: new Date().toISOString(),
              scheduled_for: new Date().toISOString(),
              started_at: new Date().toISOString(),
              completed_at: null,
              error: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            error: null
          }
        }
        return { data: null, error: null }
      }
      return { data: true, error: null }
    })

    try {
      registerJobHandler('capture-deadline-handler', async (_payload, ctx) => {
        captured = ctx.softDeadlineAt
        return {}
      })
    } catch {
      // already registered — fine
    }

    const deadlineMs = 240_000
    const start = Date.now()
    await runWorkerTick({ classes: ['batch'], deadlineMs })

    expect(captured).toBeDefined()
    const expected = start + deadlineMs - 5_000 // SAFETY_MARGIN_MS
    expect(Math.abs((captured as number) - expected)).toBeLessThan(2_000)
  }, 10_000)
})

function workQueueJob(id: number, jobType: string, attempts: number) {
  const now = new Date().toISOString()
  return {
    id,
    job_type: jobType,
    job_class: 'verify' as const,
    payload: { marker: 'unchanged' },
    dedupe_key: `test-${id}`,
    status: 'processing' as const,
    priority: 1,
    attempts,
    max_attempts: 10,
    claimed_by: 'test-worker',
    claimed_at: now,
    scheduled_for: now,
    started_at: now,
    completed_at: null,
    error: null,
    created_at: now,
    updated_at: now
  }
}

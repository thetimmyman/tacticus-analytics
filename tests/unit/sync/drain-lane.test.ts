/** Lanes need DISTINCT worker_ids: complete_job/fail_job match on (job_id, worker_id). */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const processJob = vi.fn()

vi.mock('@/app/lib/sync/sync-worker-service', () => ({
  processJob: (...args: unknown[]) => processJob(...args)
}))

import {
  laneWindowMs,
  laneWorkerId,
  readQueueDepth,
  runDrainLane
} from '@/app/lib/sync/drain-lane'
import {
  WORKER_CONFIG,
  DEFAULT_DRAIN_LANES,
  resolveDrainLanes
} from '@/app/lib/sync/worker-types'

type ClaimRow = {
  id: string
  guild_code: string
  job_type: string
  payload: null
  started_at?: string
  attempts?: number
}

function job(id: string): ClaimRow {
  return {
    id,
    guild_code: `G${id}`,
    job_type: 'incremental_sync',
    payload: null
  }
}

function makeClient(rows: ClaimRow[]) {
  const remaining = [...rows]
  const claimsByWorker: Record<string, string[]> = {}

  const rpc = vi.fn(async (fn: string, params?: Record<string, unknown>) => {
    if (fn !== 'claim_next_job') return { data: null, error: null }
    const workerId = String(params?.p_worker_id ?? '')
    const next = remaining.shift() ?? null
    if (next) {
      claimsByWorker[workerId] = [...(claimsByWorker[workerId] ?? []), next.id]
    }
    return { data: next, error: null }
  })

  return {
    client: { rpc, rest: {} } as never,
    rpc,
    claimsByWorker
  }
}

function fakeClock(steps: number[]) {
  let index = 0
  return () => {
    const value = steps[Math.min(index, steps.length - 1)]
    index += 1
    return value
  }
}

describe('drain lanes', () => {
  beforeEach(() => {
    processJob.mockReset()
    processJob.mockImplementation(async (claimed: { id: string }) => ({
      jobId: claimed.id,
      success: true,
      recordsProcessed: 1,
      playersUpdated: 0,
      errors: [],
      upsertFailures: 0,
      duration: 1
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('lane identity', () => {
    it('gives each lane its own worker_id derived from the run id', () => {
      expect(laneWorkerId('w-1-abc', 0)).toBe('w-1-abc-l0')
      expect(laneWorkerId('w-1-abc', 1)).toBe('w-1-abc-l1')
      expect(laneWorkerId('w-1-abc', 0)).not.toBe(laneWorkerId('w-1-abc', 1))
    })

    it('hands the claimed generation and lane deadline to the job processor', async () => {
      const { client } = makeClient([
        {
          ...job('a'),
          started_at: '2026-10-28T12:00:00.123456+00:00',
          attempts: 4
        }
      ])

      await runDrainLane({
        supabase: client,
        laneIndex: 0,
        laneWorkerId: 'w-run-l0',
        startTime: 1000,
        budgetMs: 45000,
        tailReserveMs: 5000,
        now: () => 1000
      })

      expect(processJob).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'a',
          claimStartedAt: '2026-10-28T12:00:00.123456+00:00',
          claimAttempts: 4,
          reconciliationDeadlineMs: 41000
        }),
        client,
        'w-run-l0'
      )
    })

    it('claims under the lane worker_id, not the run worker_id', async () => {
      const { client, claimsByWorker } = makeClient([job('a')])

      await runDrainLane({
        supabase: client,
        laneIndex: 1,
        laneWorkerId: laneWorkerId('w-run', 1),
        startTime: 0,
        budgetMs: 45000,
        tailReserveMs: 5000,
        now: fakeClock([0, 0, 0, 0, 0, 0])
      })

      expect(Object.keys(claimsByWorker)).toEqual(['w-run-l1'])
      expect(processJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
        client,
        'w-run-l1'
      )
    })
  })

  describe('exclusivity across concurrent lanes', () => {
    it('never hands the same job to two lanes and drains each job once', async () => {
      const rows = ['a', 'b', 'c', 'd'].map(job)
      const { client, claimsByWorker } = makeClient(rows)

      const outcomes = await Promise.all(
        [0, 1].map((laneIndex) =>
          runDrainLane({
            supabase: client,
            laneIndex,
            laneWorkerId: laneWorkerId('w-run', laneIndex),
            startTime: 0,
            budgetMs: 45000,
            tailReserveMs: 5000,
            now: () => 0
          })
        )
      )

      const drained = outcomes
        .flatMap((outcome) => outcome.results.map((r) => r.jobId))
        .sort()

      expect(drained).toEqual(['a', 'b', 'c', 'd'])
      expect(new Set(drained).size).toBe(drained.length)

      // A drain where one lane takes everything is just serial.
      expect(claimsByWorker['w-run-l0']?.length).toBeGreaterThan(0)
      expect(claimsByWorker['w-run-l1']?.length).toBeGreaterThan(0)

      const l0 = new Set(claimsByWorker['w-run-l0'] ?? [])
      for (const id of claimsByWorker['w-run-l1'] ?? []) {
        expect(l0.has(id)).toBe(false)
      }

      for (const outcome of outcomes) {
        expect(outcome.stoppedReason).toBe('queue_empty')
      }
    })
  })

  describe('the per-lane budget', () => {
    it('stops at budget minus the tail reserve, not at the budget', () => {
      expect(laneWindowMs(45000, 5000)).toBe(40000)
      expect(laneWindowMs(45000, 0)).toBe(45000)
      expect(laneWindowMs(1000, 5000)).toBe(0)
    })

    it('does not start a job once the window has closed', async () => {
      const { client, rpc } = makeClient([job('a'), job('b')])

      const outcome = await runDrainLane({
        supabase: client,
        laneIndex: 0,
        laneWorkerId: 'w-run-l0',
        startTime: 0,
        budgetMs: 45000,
        tailReserveMs: 5000,
        now: fakeClock([0, 41000, 41000])
      })

      expect(outcome.jobsDrained).toBe(1)
      expect(outcome.stoppedReason).toBe('budget_exhausted')
      expect(
        rpc.mock.calls.filter(([fn]) => fn === 'claim_next_job')
      ).toHaveLength(1)
    })

    it('reports budget exhaustion separately from an empty queue', async () => {
      const { client } = makeClient([])

      const outcome = await runDrainLane({
        supabase: client,
        laneIndex: 0,
        laneWorkerId: 'w-run-l0',
        startTime: 0,
        budgetMs: 45000,
        tailReserveMs: 5000,
        now: () => 0
      })

      expect(outcome.jobsDrained).toBe(0)
      expect(outcome.stoppedReason).toBe('queue_empty')
    })
  })

  describe('a lane failure is contained', () => {
    it('stops the lane on a claim error instead of throwing', async () => {
      const rpc = vi.fn(async () => ({
        data: null,
        error: { message: 'boom' }
      }))

      const outcome = await runDrainLane({
        supabase: { rpc, rest: {} } as never,
        laneIndex: 0,
        laneWorkerId: 'w-run-l0',
        startTime: 0,
        budgetMs: 45000,
        tailReserveMs: 5000,
        now: () => 0
      })

      expect(outcome.stoppedReason).toBe('claim_error')
      expect(outcome.jobsDrained).toBe(0)
    })
  })

  describe('queue depth sampling', () => {
    it('samples only claimable pending rows and measures age from claimable timestamp', async () => {
      const fixedNow = Date.parse('2026-11-16T06:45:00.000Z')
      const nowIso = new Date(fixedNow).toISOString()
      const createdImmediate = new Date(fixedNow - 600_000).toISOString()
      const createdStaggered = new Date(fixedNow - 2_400_000).toISOString()
      const scheduledStaggered = new Date(fixedNow - 60_000).toISOString()
      const countOrCalls: string[] = []
      const ageOrCalls: string[] = []

      const makeOrderChain = (
        rows: Array<{ created_at: string; scheduled_for?: string | null }>
      ) => {
        const chain: Record<string, unknown> = {
          order: vi.fn(() => chain),
          limit: vi.fn(async () => ({
            data: rows,
            error: null
          }))
        }
        return chain
      }

      const client = {
        from: vi.fn(() => ({
          select: vi.fn((_columns: string, opts?: { head?: boolean }) =>
            opts?.head
              ? {
                  eq: vi.fn(() => ({
                    or: vi.fn(async (filter: string) => {
                      countOrCalls.push(filter)
                      return { count: 7, error: null }
                    })
                  }))
                }
              : {
                  eq: vi.fn(() => ({
                    or: vi.fn((filter: string) => {
                      ageOrCalls.push(filter)
                      return makeOrderChain([
                        {
                          created_at: createdStaggered,
                          scheduled_for: scheduledStaggered
                        },
                        {
                          created_at: createdImmediate,
                          scheduled_for: null
                        }
                      ])
                    })
                  }))
                }
          )
        }))
      } as never

      const sample = await readQueueDepth(client, () => fixedNow)

      expect(countOrCalls).toEqual([
        `scheduled_for.is.null,scheduled_for.lte.${nowIso}`
      ])
      expect(ageOrCalls).toEqual([
        `scheduled_for.is.null,scheduled_for.lte.${nowIso}`
      ])
      expect(sample.pendingDepth).toBe(7)
      // Staggered row was created 2400s ago but only became claimable 60s ago;
      // the unscheduled row from 600s ago is the oldest claimable job.
      expect(sample.oldestPendingAgeSeconds).toBe(600)
    })

    it('does not count deferred wait before scheduled_for in oldestPendingAgeSeconds', async () => {
      const fixedNow = Date.parse('2026-11-16T06:45:00.000Z')
      const createdStaggered = new Date(fixedNow - 2_400_000).toISOString()
      const scheduledStaggered = new Date(fixedNow - 45_000).toISOString()

      const makeOrderChain = () => {
        const chain: Record<string, unknown> = {
          order: vi.fn(() => chain),
          limit: vi.fn(async () => ({
            data: [
              {
                created_at: createdStaggered,
                scheduled_for: scheduledStaggered
              }
            ],
            error: null
          }))
        }
        return chain
      }

      const client = {
        from: vi.fn(() => ({
          select: vi.fn((_columns: string, opts?: { head?: boolean }) =>
            opts?.head
              ? {
                  eq: vi.fn(() => ({
                    or: vi.fn(async () => ({ count: 3, error: null }))
                  }))
                }
              : {
                  eq: vi.fn(() => ({
                    or: vi.fn(() => makeOrderChain())
                  }))
                }
          )
        }))
      } as never

      const sample = await readQueueDepth(client, () => fixedNow)

      expect(sample.pendingDepth).toBe(3)
      expect(sample.oldestPendingAgeSeconds).toBe(45)
    })

    it('reports nulls rather than zeros when timestamps are unparseable or reads fail', async () => {
      const fixedNow = Date.parse('2026-11-16T06:45:00.000Z')
      const makeBadTimestampChain = () => {
        const chain: Record<string, unknown> = {
          order: vi.fn(() => chain),
          limit: vi.fn(async () => ({
            data: [{ created_at: 'not-a-timestamp', scheduled_for: null }],
            error: null
          }))
        }
        return chain
      }

      const badTimestampClient = {
        from: vi.fn(() => ({
          select: vi.fn((_columns: string, opts?: { head?: boolean }) =>
            opts?.head
              ? {
                  eq: vi.fn(() => ({
                    or: vi.fn(async () => ({ count: null, error: null }))
                  }))
                }
              : {
                  eq: vi.fn(() => ({
                    or: vi.fn(() => makeBadTimestampChain())
                  }))
                }
          )
        }))
      } as never

      const badSample = await readQueueDepth(badTimestampClient, () => fixedNow)
      expect(badSample.pendingDepth).toBeNull()
      expect(badSample.oldestPendingAgeSeconds).toBeNull()

      const throwingClient = {
        from: vi.fn(() => {
          throw new Error('no client')
        })
      } as never

      const sample = await readQueueDepth(throwingClient)

      // NULL means "not measured", not an empty queue.
      expect(sample.pendingDepth).toBeNull()
      expect(sample.oldestPendingAgeSeconds).toBeNull()
    })
  })

  describe('the configuration the lanes are cut from', () => {
    it('keeps the 40s window invariant the ticket measures against', () => {
      expect(resolveDrainLanes({})).toBe(DEFAULT_DRAIN_LANES)
      expect(
        laneWindowMs(
          WORKER_CONFIG.workerTimeout,
          WORKER_CONFIG.laneTailReserveMs
        )
      ).toBe(40000)
      // Must fit under the 70s scheduler deadline and above apiTimeout + backoff.
      expect(WORKER_CONFIG.workerTimeout).toBeLessThan(70000)
      expect(WORKER_CONFIG.workerTimeout).toBeGreaterThan(
        WORKER_CONFIG.apiTimeout +
          WORKER_CONFIG.retryDelay * 2 ** (WORKER_CONFIG.maxRetries - 1)
      )
    })
  })
})

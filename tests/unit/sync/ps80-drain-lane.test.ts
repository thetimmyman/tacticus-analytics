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

describe('PS-80 drain lanes', () => {
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
    it('reports depth and oldest pending age', async () => {
      const created = new Date(Date.now() - 600_000).toISOString()
      const client = {
        from: vi.fn(() => ({
          select: vi.fn((_columns: string, opts?: { head?: boolean }) =>
            opts?.head
              ? {
                  eq: vi.fn(async () => ({ count: 7, error: null }))
                }
              : {
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(async () => ({
                        data: [{ created_at: created }],
                        error: null
                      }))
                    }))
                  }))
                }
          )
        }))
      } as never

      const sample = await readQueueDepth(client)

      expect(sample.pendingDepth).toBe(7)
      expect(sample.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(599)
    })

    it('reports nulls rather than zeros when the read cannot be made', async () => {
      const client = {
        from: vi.fn(() => {
          throw new Error('no client')
        })
      } as never

      const sample = await readQueueDepth(client)

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

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

type QueueRow = {
  id: string
  status: string
  created_at: string | null
  scheduled_for: string | null
  attempts: number | null
  max_attempts: number | null
}

type QueueOrder = {
  column: string
  ascending: boolean
  nullsFirst?: boolean | null
}

type QueueQuery = {
  columns: string[]
  head: boolean
  filters: Array<{ column: string; value: unknown }>
  orFilters: string[]
  orders: QueueOrder[]
  after: { column: string; value: string } | null
  limit: number | null
}

/** PostgREST-shaped row set: eq/or filters, multi-key ORDER BY, keyset gt, LIMIT. */
function queueRowClient(
  rows: QueueRow[],
  options: { failFromPage?: number } = {}
) {
  const queries: QueueQuery[] = []
  const orFilters: string[] = []
  const selectedColumns: string[] = []
  let pages = 0

  const matchesOr = (row: QueueRow, filter: string) =>
    filter.split(',').some((term) => {
      const first = term.indexOf('.')
      const second = term.indexOf('.', first + 1)
      const column = term.slice(0, first)
      const operator = term.slice(first + 1, second)
      const value = term.slice(second + 1)
      const actual = (row as unknown as Record<string, unknown>)[column]
      if (operator === 'is' && value === 'null') {
        return actual === null || actual === undefined
      }
      if (operator === 'lte') {
        return (
          typeof actual === 'string' && Date.parse(actual) <= Date.parse(value)
        )
      }
      throw new Error(`Unsupported or() term: ${term}`)
    })

  const compare = (query: QueueQuery) => (left: QueueRow, right: QueueRow) => {
    for (const order of query.orders) {
      const a =
        (left as unknown as Record<string, unknown>)[order.column] ?? null
      const b =
        (right as unknown as Record<string, unknown>)[order.column] ?? null
      if (a === b) continue
      if (a === null || b === null) {
        const nullsFirst = order.nullsFirst ?? !order.ascending
        if (a === null) return nullsFirst ? -1 : 1
        return nullsFirst ? 1 : -1
      }
      const cmp = String(a) < String(b) ? -1 : 1
      return order.ascending ? cmp : -cmp
    }
    return 0
  }

  const execute = (query: QueueQuery) => {
    pages += 1
    if (options.failFromPage && pages >= options.failFromPage) {
      return { data: null, error: { message: 'queue read failed' } }
    }
    let matched = rows.filter((row) =>
      query.filters.every(
        ({ column, value }) =>
          (row as unknown as Record<string, unknown>)[column] === value
      )
    )
    for (const filter of query.orFilters) {
      matched = matched.filter((row) => matchesOr(row, filter))
    }
    if (query.after) {
      matched = matched.filter(
        (row) =>
          String(
            (row as unknown as Record<string, unknown>)[query.after!.column]
          ) > query.after!.value
      )
    }
    const sorted = [...matched].sort(compare(query))
    const limited = (
      query.limit === null ? sorted : sorted.slice(0, query.limit)
    ).map((row) => ({ ...row }))
    return query.head
      ? { data: null, count: limited.length, error: null }
      : { data: limited, error: null }
  }

  const makeChain = (query: QueueQuery) => {
    const chain = {
      select: (columns: string, opts?: { head?: boolean }) => {
        query.columns = columns.split(',').map((column) => column.trim())
        query.head = Boolean(opts?.head)
        selectedColumns.push(columns)
        return chain
      },
      eq: (column: string, value: unknown) => {
        query.filters.push({ column, value })
        return chain
      },
      or: (filter: string) => {
        query.orFilters.push(filter)
        orFilters.push(filter)
        return chain
      },
      order: (
        column: string,
        opts?: { ascending?: boolean; nullsFirst?: boolean }
      ) => {
        query.orders.push({
          column,
          ascending: opts?.ascending ?? true,
          nullsFirst: opts?.nullsFirst
        })
        return chain
      },
      gt: (column: string, value: string) => {
        query.after = { column, value }
        return chain
      },
      limit: (count: number) => {
        query.limit = count
        return chain
      },
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(execute(query)).then(resolve, reject)
    }
    return chain
  }

  return {
    client: {
      from: (table: string) => {
        if (table !== 'sync_queue') throw new Error(`unexpected table ${table}`)
        const query: QueueQuery = {
          columns: [],
          head: false,
          filters: [],
          orFilters: [],
          orders: [],
          after: null,
          limit: null
        }
        queries.push(query)
        return makeChain(query)
      }
    } as never,
    queries,
    orFilters,
    selectedColumns,
    pagesRead: () => pages
  }
}

let rowSequence = 0
function queueRow(overrides: Partial<QueueRow> = {}): QueueRow {
  rowSequence += 1
  return {
    id: `00000000-0000-4000-8000-${String(rowSequence).padStart(12, '0')}`,
    status: 'pending',
    created_at: null,
    scheduled_for: null,
    attempts: 0,
    max_attempts: 3,
    ...overrides
  }
}

function isoAt(epochMs: number): string {
  return new Date(epochMs).toISOString()
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
    const fixedNow = Date.parse('2026-11-16T06:45:00.000Z')
    const nowIso = isoAt(fixedNow)

    it('reports the true oldest claimable age once the queue is deeper than one scan page', async () => {
      // 260 young unscheduled rows sort ahead of an older scheduled job under
      // `scheduled_for NULLS FIRST, created_at`; a single 250-row page therefore
      // reported 60s instead of the job that has been claimable for an hour.
      const young = isoAt(fixedNow - 60_000)
      const oldCreated = isoAt(fixedNow - 7_200_000)
      const oldScheduled = isoAt(fixedNow - 3_600_000)
      const rows: QueueRow[] = Array.from({ length: 260 }, () =>
        queueRow({ created_at: young, scheduled_for: null })
      )
      rows.push(
        queueRow({
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          created_at: oldCreated,
          scheduled_for: oldScheduled
        })
      )
      const queue = queueRowClient(rows)

      const sample = await readQueueDepth(queue.client, () => fixedNow)

      expect(sample.pendingDepth).toBe(261)
      expect(sample.oldestPendingAgeSeconds).toBe(3600)
      expect(queue.pagesRead()).toBeGreaterThan(1)
    })

    it('counts only rows with attempts left, matching the claim and health predicates', async () => {
      const exhausted = queueRow({
        created_at: isoAt(fixedNow - 21_600_000),
        scheduled_for: null,
        attempts: 3,
        max_attempts: 3
      })
      const claimable = queueRow({
        created_at: isoAt(fixedNow - 120_000),
        scheduled_for: null,
        attempts: 2,
        max_attempts: 3
      })
      const missingAttempts = queueRow({
        created_at: isoAt(fixedNow - 43_200_000),
        scheduled_for: null,
        attempts: null,
        max_attempts: 3
      })
      const queue = queueRowClient([exhausted, missingAttempts, claimable])

      const sample = await readQueueDepth(queue.client, () => fixedNow)

      expect(sample.pendingDepth).toBe(1)
      expect(sample.oldestPendingAgeSeconds).toBe(120)
    })

    it('reads only claimable pending rows with the columns the claim predicate needs', async () => {
      const queue = queueRowClient([])

      const sample = await readQueueDepth(queue.client, () => fixedNow)

      expect(queue.orFilters).toEqual([
        `scheduled_for.is.null,scheduled_for.lte.${nowIso}`
      ])
      expect(queue.queries[0].filters).toEqual([
        { column: 'status', value: 'pending' }
      ])
      expect(queue.selectedColumns[0]).toEqual(
        expect.stringContaining('attempts')
      )
      expect(queue.selectedColumns[0]).toEqual(
        expect.stringContaining('max_attempts')
      )
      // An empty claimable queue is a measured zero depth, not an unmeasured null.
      expect(sample.pendingDepth).toBe(0)
      expect(sample.oldestPendingAgeSeconds).toBeNull()
    })

    it('does not count deferred wait before scheduled_for in oldestPendingAgeSeconds', async () => {
      const queue = queueRowClient([
        queueRow({
          created_at: isoAt(fixedNow - 2_400_000),
          scheduled_for: isoAt(fixedNow - 45_000)
        })
      ])

      const sample = await readQueueDepth(queue.client, () => fixedNow)

      expect(sample.pendingDepth).toBe(1)
      expect(sample.oldestPendingAgeSeconds).toBe(45)
    })

    it('still counts a row whose timestamp cannot be parsed as depth, without inventing an age', async () => {
      const queue = queueRowClient([
        queueRow({ created_at: 'not-a-timestamp', scheduled_for: null })
      ])

      const sample = await readQueueDepth(queue.client, () => fixedNow)

      expect(sample.pendingDepth).toBe(1)
      expect(sample.oldestPendingAgeSeconds).toBeNull()
    })

    it('reports nulls rather than a partial measurement when a page read fails', async () => {
      const rows: QueueRow[] = Array.from({ length: 250 }, () =>
        queueRow({ created_at: isoAt(fixedNow - 60_000), scheduled_for: null })
      )
      const queue = queueRowClient(rows, { failFromPage: 2 })

      const sample = await readQueueDepth(queue.client, () => fixedNow)

      // A scan that stopped halfway cannot prove either the true depth or age.
      expect(sample.pendingDepth).toBeNull()
      expect(sample.oldestPendingAgeSeconds).toBeNull()
    })

    it('reports nulls rather than zeros when the client throws', async () => {
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

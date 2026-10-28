/**
 * A completed `complete_job` whose HTTP response was lost must be proven from the
 * committed row exactly once. Speculative retries are forbidden: complete_job has
 * no generation predicate and could settle a later claim owned by the same worker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: vi.fn()
}))

import { completeSyncJob } from '@/app/lib/sync/sync-job-lifecycle'
import type {
  ServiceSupabaseClient,
  SyncJob,
  WorkerResult
} from '@/app/lib/sync/worker-types'

const GUILD = 'SYNTH01'
const JOB_ID = '00000000-0000-4000-8000-0000000000a1'
const WORKER = 'synthetic-worker-l0'
const STARTED_AT = '2026-10-27T12:00:00.123456+00:00'
const COMPLETED_AT = '2026-10-27T12:00:01.654321+00:00'
const OLDER_CLOCK = '2026-10-27T11:00:00.000000+00:00'

type RpcReply = { data: unknown; error: unknown; status?: unknown }
type ReadReply = { data: unknown; error: unknown }

interface DbOptions {
  completeReply?: RpcReply | (() => Promise<RpcReply>)
  read?: (signal: AbortSignal) => Promise<ReadReply>
  readRow?: Record<string, unknown> | null
  readError?: unknown
  storedClock?: string | null
  clockError?: unknown
  clockThrows?: unknown
  clockWaitsForAbort?: boolean
}

/** Fixtures are fixed-width UTC literals, so exact lexical order is microsecond order. */
function comparableTimestamp(value: string) {
  return value.endsWith('Z') ? `${value.slice(0, -1)}+00:00` : value
}

function fakeDb(options: DbOptions = {}) {
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const fromCalls: string[] = []
  const updates: Array<{
    table: string
    payload: Record<string, unknown>
    eq: [string, unknown]
    or?: string
    applied: boolean
  }> = []
  const clock = new Map<string, string | null>([
    [GUILD, options.storedClock ?? null]
  ])
  let completeCalls = 0
  let readCalls = 0
  let lastSignal: AbortSignal | undefined
  let clockSignal: AbortSignal | undefined

  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    if (fn !== 'complete_job') {
      throw new Error(`unexpected rpc: ${fn}`)
    }
    completeCalls += 1
    if (typeof options.completeReply === 'function') {
      return options.completeReply()
    }
    return options.completeReply ?? { data: true, error: null }
  })

  const client = {
    rpc,
    from(table: string) {
      fromCalls.push(table)

      if (table === 'sync_queue') {
        return {
          select(_columns: string) {
            const chain = {
              eq(_column: string, _value: unknown) {
                return chain
              },
              abortSignal(signal: AbortSignal) {
                lastSignal = signal
                return chain
              },
              async maybeSingle(): Promise<ReadReply> {
                readCalls += 1
                if (options.read) {
                  return options.read(lastSignal as AbortSignal)
                }
                if (options.readError) {
                  return { data: null, error: options.readError }
                }
                return { data: options.readRow ?? null, error: null }
              }
            }
            return chain
          }
        }
      }

      if (table === 'guild_config') {
        return {
          update(payload: Record<string, unknown>) {
            return {
              eq(column: string, value: unknown) {
                const record = {
                  table,
                  payload,
                  eq: [column, value] as [string, unknown],
                  or: undefined as string | undefined,
                  applied: false
                }
                const apply = (filter?: string) => {
                  if (record.applied) return
                  record.applied = true
                  record.or = filter
                  updates.push(record)

                  if (
                    options.clockThrows ||
                    options.clockError ||
                    options.clockWaitsForAbort
                  )
                    return
                  const requested = payload.last_successful_sync
                  if (typeof requested !== 'string') return
                  const stored = clock.get(String(value)) ?? null
                  const atomic =
                    filter === undefined ||
                    stored === null ||
                    comparableTimestamp(stored) < comparableTimestamp(requested)
                  if (atomic) {
                    clock.set(String(value), requested)
                  }
                }

                return {
                  abortSignal(signal: AbortSignal) {
                    clockSignal = signal
                    return this
                  },
                  async or(filter: string) {
                    apply(filter)
                    if (options.clockWaitsForAbort) {
                      await new Promise((_resolve, reject) => {
                        if (clockSignal?.aborted)
                          reject(new DOMException('aborted', 'AbortError'))
                        clockSignal?.addEventListener(
                          'abort',
                          () =>
                            reject(new DOMException('aborted', 'AbortError')),
                          { once: true }
                        )
                      })
                    }
                    if (options.clockThrows) throw options.clockThrows
                    return { error: options.clockError ?? null }
                  },
                  then(
                    resolve: (value: { error: unknown }) => unknown,
                    reject: (reason: unknown) => unknown
                  ) {
                    return Promise.resolve()
                      .then(() => {
                        apply()
                        return { error: options.clockError ?? null }
                      })
                      .then(resolve, reject)
                  }
                }
              }
            }
          }
        }
      }

      throw new Error(`unexpected table write: ${table}`)
    }
  }

  return {
    client: client as unknown as ServiceSupabaseClient,
    rpcCalls,
    fromCalls,
    updates,
    clock,
    get completeCalls() {
      return completeCalls
    },
    get readCalls() {
      return readCalls
    },
    get lastSignal() {
      return lastSignal
    }
  }
}

function job(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: JOB_ID,
    guild_code: GUILD,
    job_type: 'incremental_sync',
    claimStartedAt: STARTED_AT,
    claimAttempts: 4,
    reconciliationDeadlineMs: Date.now() + 10_000,
    ...overrides
  }
}

function result(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    jobId: JOB_ID,
    success: false,
    recordsProcessed: 7,
    playersUpdated: 2,
    errors: [],
    upsertFailures: 0,
    raidDataLanded: true,
    duration: 0,
    ...overrides
  }
}

function committedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    worker_id: WORKER,
    status: 'completed',
    started_at: STARTED_AT,
    attempts: 4,
    completed_at: COMPLETED_AT,
    ...overrides
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('completeSyncJob — lost completion response reconciliation', () => {
  it.each([502, 503, 504])(
    'treats HTTP %s after a committed completion as success without replaying completion',
    async (status) => {
      const db = fakeDb({
        completeReply: {
          data: null,
          error: { message: 'gateway lost the response' },
          status
        },
        readRow: committedRow(),
        storedClock: OLDER_CLOCK
      })
      const workerResult = result()

      await completeSyncJob(job(), db.client, WORKER, workerResult)

      expect(workerResult.success).toBe(true)
      expect(db.completeCalls).toBe(1)
      expect(db.readCalls).toBe(1)
      expect(db.rpcCalls.map((call) => call.fn)).toEqual(['complete_job'])
      expect(fetch).not.toHaveBeenCalled()
      expect(db.fromCalls).not.toContain('sync_metrics')
      expect(db.updates).toHaveLength(1)
      expect(db.updates[0]).toMatchObject({
        table: 'guild_config',
        payload: { last_successful_sync: COMPLETED_AT },
        eq: ['guild_code', GUILD]
      })
      expect(db.updates[0].or).toContain(COMPLETED_AT)
      expect(db.clock.get(GUILD)).toBe(COMPLETED_AT)
    }
  )

  it.each(['processing', 'pending', 'failed'])(
    'keeps the original failure when the committed row is still %s',
    async (status) => {
      const db = fakeDb({
        completeReply: {
          data: null,
          error: { message: 'gateway lost the response' },
          status: 502
        },
        readRow: committedRow({ status })
      })
      const workerResult = result()

      await expect(
        completeSyncJob(job(), db.client, WORKER, workerResult)
      ).rejects.toThrow(
        'Failed to mark job complete: gateway lost the response'
      )

      expect(workerResult.success).toBe(false)
      expect(db.completeCalls).toBe(1)
      expect(db.readCalls).toBe(1)
      expect(db.updates).toHaveLength(0)
    }
  )

  it('does not accept a completion recorded for another worker', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 503
      },
      readRow: committedRow({ worker_id: 'another-worker' })
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')

    expect(workerResult.success).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it('does not accept a claim from a different attempt of the same worker', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 504
      },
      readRow: committedRow({ attempts: 5 })
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')

    expect(workerResult.success).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it('does not treat a sub-millisecond started_at change as the same generation', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow({
        started_at: '2026-10-27T12:00:00.123457+00:00'
      })
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')

    expect(workerResult.success).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it.each([400, 409, 500, 501])(
    'does not read after a non-reconcilable HTTP %s error',
    async (status) => {
      const db = fakeDb({
        completeReply: {
          data: null,
          error: { message: `sql failure ${status}` },
          status
        },
        readRow: committedRow()
      })
      const workerResult = result()

      await expect(
        completeSyncJob(job(), db.client, WORKER, workerResult)
      ).rejects.toThrow(`Failed to mark job complete: sql failure ${status}`)

      expect(db.completeCalls).toBe(1)
      expect(db.readCalls).toBe(0)
      expect(db.fromCalls).not.toContain('sync_queue')
      expect(workerResult.success).toBe(false)
    }
  )

  it.each([
    ['an absent status', undefined],
    ['a string status', '503'],
    ['a fractional status', 503.5],
    ['a transport-abort status', 0]
  ])('does not read with %s', async (_label, status) => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'unknown transport outcome' },
        status
      },
      readRow: committedRow()
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')

    expect(db.readCalls).toBe(0)
    expect(db.fromCalls).not.toContain('sync_queue')
  })

  it('does not read when a captured claim timestamp is malformed', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow({ started_at: 'not-a-claim-timestamp' })
    })
    const workerResult = result()
    await expect(
      completeSyncJob(
        job({ claimStartedAt: 'not-a-claim-timestamp' }),
        db.client,
        WORKER,
        workerResult
      )
    ).rejects.toThrow('Failed to mark job complete')
    expect(db.readCalls).toBe(0)
    expect(workerResult.success).toBe(false)
  })

  it('does not read when the claim generation was never captured', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow()
    })
    const workerResult = result()

    await expect(
      completeSyncJob(
        job({ claimStartedAt: undefined, claimAttempts: undefined }),
        db.client,
        WORKER,
        workerResult
      )
    ).rejects.toThrow('Failed to mark job complete')

    expect(db.readCalls).toBe(0)
    expect(db.fromCalls).not.toContain('sync_queue')
  })

  it('does not read after the lane reconciliation budget has closed', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 503
      },
      readRow: committedRow()
    })
    const workerResult = result()

    await expect(
      completeSyncJob(
        job({ reconciliationDeadlineMs: Date.now() - 1 }),
        db.client,
        WORKER,
        workerResult
      )
    ).rejects.toThrow('Failed to mark job complete')

    expect(db.readCalls).toBe(0)
    expect(db.fromCalls).not.toContain('sync_queue')
  })

  it('does not treat malformed null data and error as transient', async () => {
    const db = fakeDb({
      completeReply: { data: null, error: null, status: 502 },
      readRow: committedRow()
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Job completion refused')

    expect(db.readCalls).toBe(0)
  })

  it('does not read when a contradictory true result accompanies the error', async () => {
    const db = fakeDb({
      completeReply: {
        data: true,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow()
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')

    expect(db.readCalls).toBe(0)
    expect(workerResult.success).toBe(false)
  })

  it('keeps the ordinary success path free of a proof read', async () => {
    const db = fakeDb({
      completeReply: { data: true, error: null },
      storedClock: OLDER_CLOCK
    })
    const workerResult = result()

    await completeSyncJob(job(), db.client, WORKER, workerResult)

    expect(workerResult.success).toBe(true)
    expect(db.completeCalls).toBe(1)
    expect(db.readCalls).toBe(0)
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].or).toBeUndefined()
    expect(db.updates[0].payload.last_successful_sync).not.toBe(COMPLETED_AT)
  })

  it.each([
    ['malformed', 'not-a-timestamp'],
    ['naive without a timezone', '2026-10-27T12:00:00.123456'],
    ['an impossible calendar day', '2026-02-30T12:00:00.123456Z'],
    ['an invalid offset', '2026-10-27T12:00:00.123456+24:00']
  ])(
    'keeps the original failure when completed_at is %s',
    async (_label, completedAt) => {
      const db = fakeDb({
        completeReply: {
          data: null,
          error: { message: 'gateway lost the response' },
          status: 503
        },
        readRow: committedRow({ completed_at: completedAt })
      })
      const workerResult = result()

      await expect(
        completeSyncJob(job(), db.client, WORKER, workerResult)
      ).rejects.toThrow('Failed to mark job complete')

      expect(workerResult.success).toBe(false)
      expect(db.updates).toHaveLength(0)
    }
  )

  it('rejects a completed_at that is a microsecond in the future', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'))
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 504
      },
      readRow: committedRow({
        started_at: '2026-10-27T11:59:59.000000+00:00',
        completed_at: '2026-10-27T12:00:00.000100+00:00'
      })
    })
    const workerResult = result()

    await expect(
      completeSyncJob(
        job({
          claimStartedAt: '2026-10-27T11:59:59.000000+00:00',
          reconciliationDeadlineMs: Date.now() + 10_000
        }),
        db.client,
        WORKER,
        workerResult
      )
    ).rejects.toThrow('Failed to mark job complete')

    expect(workerResult.success).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it('accepts a completed_at a microsecond before now and keeps its exact precision', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T12:00:00.001Z'))
    const completedAt = '2026-10-27T12:00:00.000999Z'
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow({
        started_at: '2026-10-27T11:59:59.123456+00:00',
        completed_at: completedAt
      }),
      storedClock: OLDER_CLOCK
    })
    const workerResult = result()

    await completeSyncJob(
      job({
        claimStartedAt: '2026-10-27T11:59:59.123456+00:00',
        reconciliationDeadlineMs: Date.now() + 10_000
      }),
      db.client,
      WORKER,
      workerResult
    )

    expect(workerResult.success).toBe(true)
    expect(db.updates[0].payload.last_successful_sync).toBe(completedAt)
    expect(db.clock.get(GUILD)).toBe(completedAt)
  })

  it('rejects a completion timestamp preceding its exact claim generation', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow({
        completed_at: '2026-10-27T12:00:00.123455+00:00'
      })
    })
    const workerResult = result()
    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')
    expect(workerResult.success).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it('accepts a valid numeric offset while preserving the exact database timestamp', async () => {
    const completedAt = '2026-10-28T03:00:01.654321+15:00'
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 503
      },
      readRow: committedRow({ completed_at: completedAt })
    })
    const workerResult = result()
    await completeSyncJob(job(), db.client, WORKER, workerResult)
    expect(workerResult.success).toBe(true)
    expect(db.clock.get(GUILD)).toBe(completedAt)
  })

  it('keeps the original failure when the proof read returns an RLS error', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 503
      },
      readError: { message: 'row-level security denied' }
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')

    expect(db.readCalls).toBe(1)
    expect(db.updates).toHaveLength(0)
  })

  it('keeps the original failure when the proof read returns no row', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      read: async () => ({ data: null, error: null })
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')

    expect(db.updates).toHaveLength(0)
  })

  it('keeps the original failure when the proof read rejects', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 504
      },
      read: async () => {
        throw new Error('connection reset')
      }
    })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete: gateway lost the response')

    expect(db.updates).toHaveLength(0)
  })

  it('aborts the proof read at the 1500ms cap', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'))
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      read: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    })
    const workerResult = result()
    const pending = completeSyncJob(
      job({ reconciliationDeadlineMs: Date.now() + 10_000 }),
      db.client,
      WORKER,
      workerResult
    )
    const assertion = expect(pending).rejects.toThrow(
      'Failed to mark job complete'
    )

    await vi.advanceTimersByTimeAsync(1499)
    expect(db.lastSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(db.lastSignal?.aborted).toBe(true)

    await assertion
    expect(workerResult.success).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it('caps the proof read at the remaining lane budget instead of 1500ms', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'))
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 503
      },
      read: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    })
    const workerResult = result()
    const pending = completeSyncJob(
      job({ reconciliationDeadlineMs: Date.now() + 200 }),
      db.client,
      WORKER,
      workerResult
    )
    const assertion = expect(pending).rejects.toThrow(
      'Failed to mark job complete'
    )

    await vi.advanceTimersByTimeAsync(199)
    expect(db.lastSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(db.lastSignal?.aborted).toBe(true)

    await assertion
  })

  it('rejects a response past the read cap even before the abort timer runs', async () => {
    vi.useFakeTimers()
    const started = Date.parse('2026-10-27T12:00:10.000Z')
    vi.setSystemTime(started)
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      read: async () => {
        vi.setSystemTime(started + 1500)
        return { data: committedRow(), error: null }
      }
    })
    const workerResult = result()
    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Failed to mark job complete')
    expect(workerResult.success).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it('rejects a proof that only arrives after the lane budget closed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'))
    const deadline = Date.now() + 10_000
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 504
      },
      read: async () => {
        vi.setSystemTime(deadline)
        return { data: committedRow(), error: null }
      }
    })
    const workerResult = result()

    await expect(
      completeSyncJob(
        job({ reconciliationDeadlineMs: deadline }),
        db.client,
        WORKER,
        workerResult
      )
    ).rejects.toThrow('Failed to mark job complete')

    expect(db.readCalls).toBe(1)
    expect(workerResult.success).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it('bounds a stalled freshness write without replaying a proven completion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T12:00:10.000Z'))
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow(),
      storedClock: OLDER_CLOCK,
      clockWaitsForAbort: true
    })
    const workerResult = result()
    const pending = completeSyncJob(job(), db.client, WORKER, workerResult)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(pending).resolves.toBeUndefined()
    expect(workerResult.success).toBe(true)
    expect(db.completeCalls).toBe(1)
    expect(db.clock.get(GUILD)).toBe(OLDER_CLOCK)
  })

  it('does not regress a newer last_successful_sync and still keeps exact microseconds', async () => {
    const newerStored = '2026-10-27T12:00:01.654322+00:00'
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow(),
      storedClock: newerStored
    })
    const workerResult = result()

    await completeSyncJob(job(), db.client, WORKER, workerResult)

    expect(workerResult.success).toBe(true)
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].payload.last_successful_sync).toBe(COMPLETED_AT)
    expect(db.updates[0].or).toBe(
      `last_successful_sync.is.null,last_successful_sync.lt.${COMPLETED_AT}`
    )
    expect(db.clock.get(GUILD)).toBe(newerStored)
  })

  it('writes the exact committed microseconds when the stored clock is older', async () => {
    const exact = '2026-10-27T12:00:01.654321+00:00'
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 503
      },
      readRow: committedRow({ completed_at: exact }),
      storedClock: '2026-10-27T12:00:01.654320+00:00'
    })
    const workerResult = result()

    await completeSyncJob(job(), db.client, WORKER, workerResult)

    expect(db.updates[0].payload.last_successful_sync).toBe(exact)
    expect(db.clock.get(GUILD)).toBe(exact)
  })

  it.each([
    ['no landed raid data', { raidDataLanded: false }],
    ['upsert failures', { upsertFailures: 1 }]
  ])(
    'preserves the freshness gate for a reconciled completion: %s',
    async (_label, overrides) => {
      const db = fakeDb({
        completeReply: {
          data: null,
          error: { message: 'gateway lost the response' },
          status: 502
        },
        readRow: committedRow(),
        storedClock: OLDER_CLOCK
      })
      const workerResult = result(overrides as Partial<WorkerResult>)

      await completeSyncJob(job(), db.client, WORKER, workerResult)

      expect(workerResult.success).toBe(true)
      expect(db.updates).toHaveLength(0)
      expect(db.clock.get(GUILD)).toBe(OLDER_CLOCK)
    }
  )

  it.each(['player_sync', 'validation_sync'] as const)(
    'does not let a reconciled %s vouch for the raid feed',
    async (jobType) => {
      const db = fakeDb({
        completeReply: {
          data: null,
          error: { message: 'gateway lost the response' },
          status: 503
        },
        readRow: committedRow(),
        storedClock: OLDER_CLOCK
      })
      const workerResult = result()

      await completeSyncJob(
        job({ job_type: jobType }),
        db.client,
        WORKER,
        workerResult
      )

      expect(workerResult.success).toBe(true)
      expect(db.updates).toHaveLength(0)
    }
  )

  it('still reports a reconciled completion when the clock write fails', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 504
      },
      readRow: committedRow(),
      storedClock: OLDER_CLOCK,
      clockError: { message: 'database unavailable' }
    })
    const workerResult = result()

    await completeSyncJob(job(), db.client, WORKER, workerResult)

    expect(workerResult.success).toBe(true)
    expect(db.updates).toHaveLength(1)
    expect(db.clock.get(GUILD)).toBe(OLDER_CLOCK)
  })

  it('still reports a reconciled completion when the clock write throws', async () => {
    const db = fakeDb({
      completeReply: {
        data: null,
        error: { message: 'gateway lost the response' },
        status: 502
      },
      readRow: committedRow(),
      storedClock: OLDER_CLOCK,
      clockThrows: new Error('connection lost during clock write')
    })
    const workerResult = result()

    await completeSyncJob(job(), db.client, WORKER, workerResult)

    expect(workerResult.success).toBe(true)
    expect(db.updates).toHaveLength(1)
    expect(db.clock.get(GUILD)).toBe(OLDER_CLOCK)
  })

  it.each([
    ['the row id', { id: 'a-different-job' }],
    ['the worker id', { worker_id: null }],
    ['the completed state', { status: undefined }],
    ['the claimed started_at', { started_at: null }],
    ['the claimed attempt', { attempts: null }],
    ['the completion timestamp', { completed_at: null }]
  ])(
    'keeps the original failure when %s is missing',
    async (_label, overrides) => {
      const db = fakeDb({
        completeReply: {
          data: null,
          error: { message: 'gateway lost the response' },
          status: 502
        },
        readRow: committedRow(overrides)
      })
      const workerResult = result()

      await expect(
        completeSyncJob(job(), db.client, WORKER, workerResult)
      ).rejects.toThrow('Failed to mark job complete')

      expect(workerResult.success).toBe(false)
      expect(db.updates).toHaveLength(0)
    }
  )

  it('keeps the ordinary refusal when completion returns false without an error', async () => {
    const db = fakeDb({ completeReply: { data: false, error: null } })
    const workerResult = result()

    await expect(
      completeSyncJob(job(), db.client, WORKER, workerResult)
    ).rejects.toThrow('Job completion refused')

    expect(workerResult.success).toBe(false)
    expect(db.readCalls).toBe(0)
  })
})

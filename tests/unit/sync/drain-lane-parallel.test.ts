import { beforeEach, describe, expect, it, vi } from 'vitest'

const processJob = vi.fn()
vi.mock('@/app/lib/sync/sync-worker-service', () => ({
  processJob: (...args: unknown[]) => processJob(...args)
}))

import { runDrainLane } from '@/app/lib/sync/drain-lane'
import { resolveDrainLanes } from '@/app/lib/sync/worker-types'

function job(id: string, guildCode = `TESTGUILD${id}`) {
  return {
    id,
    guild_code: guildCode,
    job_type: 'incremental_sync',
    payload: null
  }
}

function outcome(id: string) {
  return {
    jobId: id,
    success: true,
    recordsProcessed: 1,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 1
  }
}

function lane(
  client: unknown,
  index: number,
  role: 'any' | 'background_first' = 'any'
) {
  return runDrainLane({
    supabase: client as never,
    laneIndex: index,
    laneWorkerId: `worker-l${index}`,
    role,
    startTime: Date.now(),
    budgetMs: 10_000,
    tailReserveMs: 0
  })
}

describe('parallel drain lanes', () => {
  beforeEach(() => {
    processJob.mockReset()
  })

  it('resolves configured lane count', () => {
    expect(resolveDrainLanes({})).toBe(3)
    expect(resolveDrainLanes({ SYNC_DRAIN_LANES: '5' })).toBe(5)
    expect(resolveDrainLanes({ SYNC_DRAIN_LANES: '0' })).toBe(1)
    expect(resolveDrainLanes({ SYNC_DRAIN_LANES: '99' })).toBe(8)
    for (const invalid of ['', 'nope', '2.5', 'Infinity']) {
      expect(resolveDrainLanes({ SYNC_DRAIN_LANES: invalid })).toBe(3)
    }
  })

  it('processes three distinct guilds concurrently', async () => {
    const rows = [job('a'), job('b'), job('c')]
    const rpc = vi.fn(async () => ({ data: rows.shift() ?? null, error: null }))
    let active = 0
    let maxActive = 0
    processJob.mockImplementation(async (claimed: { id: string }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 80))
      active -= 1
      return outcome(claimed.id)
    })

    const start = Date.now()
    const outcomes = await Promise.all(
      [0, 1, 2].map((index) => lane({ rpc }, index))
    )
    expect(maxActive).toBe(3)
    expect(Date.now() - start).toBeLessThan(220)
    expect(
      outcomes.reduce((sum, current) => sum + current.jobsDrained, 0)
    ).toBe(3)
  })

  it('tries background tiers first on the last lane then falls back', async () => {
    const calls: Array<{ worker: string; types: unknown }> = []
    const jobs = [job('a'), job('b'), job('c')]
    const rpc = vi.fn(
      async (
        _fn: string,
        args: { p_worker_id: string; p_job_types?: string[] }
      ) => {
        calls.push({ worker: args.p_worker_id, types: args.p_job_types })
        if (args.p_worker_id === 'worker-l2' && args.p_job_types) {
          return { data: null, error: null }
        }
        return { data: jobs.shift() ?? null, error: null }
      }
    )
    processJob.mockImplementation(async (claimed: { id: string }) =>
      outcome(claimed.id)
    )

    await Promise.all([
      lane({ rpc }, 0),
      lane({ rpc }, 1),
      lane({ rpc }, 2, 'background_first')
    ])

    expect(
      calls
        .filter((call) => call.worker !== 'worker-l2')
        .every((call) => call.types === undefined)
    ).toBe(true)
    const lastLane = calls.filter((call) => call.worker === 'worker-l2')
    expect(lastLane.slice(0, 3).map((call) => call.types)).toEqual([
      ['validation_sync', 'full_sync', 'player_sync'],
      ['incremental_sync'],
      undefined
    ])
  })

  it('claims a due full_sync ahead of a steady incremental stream', async () => {
    let fullSyncPending = true
    const claimedTypes: string[] = []
    let next = 0
    const rpc = vi.fn(async (_fn: string, args: { p_job_types?: string[] }) => {
      const types = args.p_job_types
      // Mirrors claim_next_job: always-due incremental work (priority 5) outranks full_sync (7).
      if (!types || types.includes('incremental_sync')) {
        next += 1
        return { data: job(`inc${next}`), error: null }
      }
      if (fullSyncPending && types.includes('full_sync')) {
        fullSyncPending = false
        return {
          data: { ...job('full', 'TESTGUILDFULL'), job_type: 'full_sync' },
          error: null
        }
      }
      return { data: null, error: null }
    })
    processJob.mockImplementation(
      async (claimed: { id: string; job_type: string }) => {
        claimedTypes.push(claimed.job_type)
        return outcome(claimed.id)
      }
    )
    let clock = 0
    await runDrainLane({
      supabase: { rpc } as never,
      laneIndex: 2,
      laneWorkerId: 'worker-l2',
      role: 'background_first',
      startTime: 0,
      budgetMs: 5,
      tailReserveMs: 0,
      now: () => clock++
    })

    expect(claimedTypes[0]).toBe('full_sync')
    expect(
      claimedTypes.slice(1).every((type) => type === 'incremental_sync')
    ).toBe(true)
  })

  it('defers a claimed job for an in-flight guild and continues draining', async () => {
    const rows = [job('a', 'TESTGUILD'), job('b', 'TESTGUILD'), job('c')]
    const updates: Array<Record<string, unknown>> = []
    const matches: Array<[string, unknown]> = []
    const rpc = vi.fn(async () => ({ data: rows.shift() ?? null, error: null }))
    const client = {
      rpc,
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: { attempts: 2 }, error: null })
            })
          })
        }),
        update: (value: Record<string, unknown>) => {
          updates.push(value)
          return {
            eq: (name: string, value: unknown) => {
              matches.push([name, value])
              return {
                eq: (nextName: string, nextValue: unknown) => {
                  matches.push([nextName, nextValue])
                  return Promise.resolve({ error: null })
                }
              }
            }
          }
        }
      }))
    }
    let activeGuild = false
    let overlap = false
    processJob.mockImplementation(
      async (claimed: { id: string; guild_code: string }) => {
        if (claimed.guild_code === 'TESTGUILD') {
          overlap ||= activeGuild
          activeGuild = true
          await new Promise((resolve) => setTimeout(resolve, 50))
          activeGuild = false
        }
        return outcome(claimed.id)
      }
    )

    const results = await Promise.all([lane(client, 0), lane(client, 1)])
    expect(overlap).toBe(false)
    expect(processJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
      expect.anything(),
      expect.anything()
    )
    expect(
      results.reduce((sum, current) => sum + current.jobsDeferred, 0)
    ).toBe(1)
    expect(results.reduce((sum, current) => sum + current.jobsDrained, 0)).toBe(
      2
    )
    expect(updates[0]).toMatchObject({
      status: 'pending',
      worker_id: null,
      started_at: null,
      attempts: 1,
      progress: { deferred: true, reason: 'guild_in_flight' }
    })
    expect(Date.parse(String(updates[0].scheduled_for))).toBeGreaterThan(
      Date.now()
    )
    expect(matches).toContainEqual(['id', 'b'])
    expect(
      matches.some(
        ([name, value]) =>
          name === 'worker_id' && String(value).startsWith('worker-l')
      )
    ).toBe(true)
  })

  it('releases the claim through fail_job when a deferral cannot be written', async () => {
    const rows = [job('a', 'TESTGUILD'), job('b', 'TESTGUILD')]
    const rpc = vi.fn(async (name: string, _args?: unknown) =>
      name === 'claim_next_job'
        ? { data: rows.shift() ?? null, error: null }
        : { data: true, error: null }
    )
    const client = {
      rpc,
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: { attempts: 1 }, error: null })
            })
          })
        }),
        update: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: { message: 'write refused' } })
          })
        })
      }))
    }
    processJob.mockImplementation(async (claimed: { id: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return outcome(claimed.id)
    })

    const results = await Promise.all([lane(client, 0), lane(client, 1)])

    const failCalls = rpc.mock.calls.filter(([name]) => name === 'fail_job')
    expect(failCalls).toHaveLength(1)
    expect(failCalls[0][1]).toMatchObject({ p_job_id: 'b' })
    expect(results.map((result) => result.stoppedReason)).toContain(
      'claim_error'
    )
  })

  it('does not defer when the claimed attempt count cannot be read', async () => {
    const rows = [job('a', 'TESTGUILD'), job('b', 'TESTGUILD')]
    const rpc = vi.fn(async (name: string, _args?: unknown) =>
      name === 'claim_next_job'
        ? { data: rows.shift() ?? null, error: null }
        : { data: true, error: null }
    )
    const update = vi.fn()
    const client = {
      rpc,
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: null,
                error: { message: 'read refused' }
              })
            })
          })
        }),
        update
      }))
    }
    processJob.mockImplementation(async (claimed: { id: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return outcome(claimed.id)
    })

    await Promise.all([lane(client, 0), lane(client, 1)])

    expect(update).not.toHaveBeenCalled()
    const failCalls = rpc.mock.calls.filter(([name]) => name === 'fail_job')
    expect(failCalls).toHaveLength(1)
    expect(failCalls[0][1]).toMatchObject({ p_job_id: 'b' })
  })
})

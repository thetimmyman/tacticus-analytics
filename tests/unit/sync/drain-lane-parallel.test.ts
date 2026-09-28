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
    expect(resolveDrainLanes({} as NodeJS.ProcessEnv)).toBe(3)
    expect(
      resolveDrainLanes({ SYNC_DRAIN_LANES: '5' } as NodeJS.ProcessEnv)
    ).toBe(5)
    expect(
      resolveDrainLanes({ SYNC_DRAIN_LANES: '0' } as NodeJS.ProcessEnv)
    ).toBe(1)
    expect(
      resolveDrainLanes({ SYNC_DRAIN_LANES: '99' } as NodeJS.ProcessEnv)
    ).toBe(8)
    for (const invalid of ['', 'nope', '2.5', 'Infinity']) {
      expect(
        resolveDrainLanes({ SYNC_DRAIN_LANES: invalid } as NodeJS.ProcessEnv)
      ).toBe(3)
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

  it('tries background types first on the last lane then falls back', async () => {
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
    expect(lastLane[0].types).toEqual([
      'full_sync',
      'incremental_sync',
      'validation_sync',
      'player_sync'
    ])
    expect(lastLane[1].types).toBeUndefined()
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
})

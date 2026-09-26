import { beforeEach, describe, expect, it, vi } from 'vitest'

/** `complete_job` moves only the attempt clock, so this lane must stamp last_successful_sync too. */

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

const callRpc = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/sync/worker-utils', () => ({ callRpc }))

import { completeSyncJob } from '@/app/lib/sync/sync-job-lifecycle'

type Update = { table: string; payload: Record<string, unknown>; eq: unknown[] }

function dbDouble() {
  const updates: Update[] = []
  const client = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            eq(...eq: unknown[]) {
              updates.push({ table, payload, eq })
              return Promise.resolve({ error: null })
            }
          }
        }
      }
    }
  }
  return { updates, client }
}

function job(jobType: string) {
  return { id: 'job-1', guild_code: 'JTLTM', job_type: jobType } as never
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1',
    success: false,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    raidDataLanded: true,
    duration: 0,
    ...overrides
  } as never
}

describe('completeSyncJob — success clock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callRpc.mockResolvedValue({ data: null, error: null })
  })

  for (const jobType of ['full_sync', 'incremental_sync', 'realtime_sync']) {
    it(`advances last_successful_sync after a clean ${jobType}`, async () => {
      const db = dbDouble()
      await completeSyncJob(job(jobType), db.client as never, 'w1', result())

      const clock = db.updates.find((u) => u.table === 'guild_config')
      expect(clock).toBeDefined()
      expect(clock?.payload).toHaveProperty('last_successful_sync')
      expect(clock?.eq).toEqual(['guild_code', 'JTLTM'])
    })
  }

  it('advances the clock for a quiet guild with zero new battles', async () => {
    const db = dbDouble()
    await completeSyncJob(
      job('incremental_sync'),
      db.client as never,
      'w1',
      result({ recordsProcessed: 0, raidDataLanded: true })
    )

    expect(db.updates.some((u) => u.table === 'guild_config')).toBe(true)
  })

  it('withholds the clock when sanitization emptied the payload', async () => {
    // Nothing survived validation: stamping would call a broken feed healthy.
    const db = dbDouble()
    await completeSyncJob(
      job('incremental_sync'),
      db.client as never,
      'w1',
      result({
        raidDataLanded: false,
        errors: ['Sanitization dropped 42 invalid entries']
      })
    )

    expect(db.updates.some((u) => u.table === 'guild_config')).toBe(false)
  })

  it('still advances when sanitization dropped SOME entries but rows landed', async () => {
    // A partly dirty run still writes rows, hence an explicit flag rather than `errors`.
    const db = dbDouble()
    await completeSyncJob(
      job('incremental_sync'),
      db.client as never,
      'w1',
      result({
        raidDataLanded: true,
        recordsProcessed: 58,
        errors: ['Sanitization dropped 2 invalid entries']
      })
    )

    expect(db.updates.some((u) => u.table === 'guild_config')).toBe(true)
  })

  it('withholds the clock when the run had upsert failures', async () => {
    const db = dbDouble()
    await completeSyncJob(
      job('full_sync'),
      db.client as never,
      'w1',
      result({ upsertFailures: 3 })
    )

    expect(db.updates.some((u) => u.table === 'guild_config')).toBe(false)
  })

  for (const jobType of ['player_sync', 'validation_sync']) {
    it(`does not let ${jobType} vouch for the raid feed`, async () => {
      const db = dbDouble()
      await completeSyncJob(job(jobType), db.client as never, 'w1', result())

      expect(db.updates.some((u) => u.table === 'guild_config')).toBe(false)
    })
  }

  it('still reports the job complete when the clock write fails', async () => {
    const client = {
      from: () => ({
        update: () => ({
          eq: () => Promise.resolve({ error: { message: 'db down' } })
        })
      })
    }
    const r = result()
    await completeSyncJob(job('full_sync'), client as never, 'w1', r)

    expect((r as unknown as { success: boolean }).success).toBe(true)
  })
})

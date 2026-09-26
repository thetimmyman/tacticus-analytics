import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A 23505 from enqueue_sync must not abort the scheduler pass for the remaining guilds. */

type DirectClientMock = {
  query: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

type SyncSchedulerHandler = (
  payload: Record<string, unknown>,
  context: { jobId: number; workerId: string; attempts: number }
) => Promise<Record<string, unknown> | void>

let mockDirectClient: DirectClientMock
let syncSchedulerHandler: SyncSchedulerHandler

const context = { jobId: 9001, workerId: 'vitest', attempts: 1 }

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

// Incremental candidates; staleness is graded on the success clock.
function incrementalGuild(code: string) {
  return {
    guild_code: code,
    enabled: true,
    last_successful_sync: isoMinutesAgo(30),
    guild_sync_status: {
      last_sync: isoMinutesAgo(30),
      status: null,
      full_sync_at: isoHoursAgo(1)
    },
    sync_health: {
      health_status: null,
      consecutive_failures: 0,
      data_freshness_hours: null,
      last_failed_sync: null
    }
  }
}

describe('sync-scheduler keeps scheduling after a 23505 dedupe rejection', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    // 05:00 UTC so the daily 06:00 validation pass does NOT run.
    vi.setSystemTime(new Date('2026-02-12T05:00:00.000Z'))

    mockDirectClient = { query: vi.fn(), rpc: vi.fn() }

    vi.doMock('@/app/lib/network/direct-supabase', () => ({
      createDirectClient: () => mockDirectClient
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      })
    }))
    vi.doMock('@/app/lib/errors/AppError', () => ({
      rethrowIfAppError: vi.fn()
    }))
    vi.doMock('@/app/lib/monitoring/sentry', () => ({
      captureSentryException: vi.fn()
    }))

    const module = await import('@/app/lib/jobs/sync-scheduler')
    syncSchedulerHandler = module.__internal.syncSchedulerHandler
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('continues past one guild that rejects with 23505 and schedules the rest', async () => {
    const guilds = [
      incrementalGuild('ALPHA'),
      incrementalGuild('DUPE'), // pending job already exists -> 23505
      incrementalGuild('BRAVO'),
      incrementalGuild('CHARLIE')
    ]
    mockDirectClient.query.mockResolvedValue({ data: guilds, error: null })

    mockDirectClient.rpc.mockImplementation(
      async (_fn: string, args: Record<string, unknown>) => {
        if (args.p_guild_code === 'DUPE') {
          return {
            data: null,
            error:
              'HTTP 409: {"code":"23505","message":"duplicate key value violates unique constraint \\"sync_queue_pending_unique\\""}'
          }
        }
        return { data: `job-${args.p_guild_code}`, error: null }
      }
    )

    const result = await syncSchedulerHandler({}, context)

    const attempted = mockDirectClient.rpc.mock.calls.map(
      (c) => (c[1] as Record<string, unknown>).p_guild_code
    )
    expect(attempted).toEqual(['ALPHA', 'DUPE', 'BRAVO', 'CHARLIE'])

    expect(result).toMatchObject({
      guildsChecked: 4,
      scheduled: 3,
      breakdown: expect.objectContaining({ incremental_sync: 3, total: 3 })
    })
  })

  it('schedules every guild when none collide (control: no early abort baked in)', async () => {
    const guilds = [
      incrementalGuild('ALPHA'),
      incrementalGuild('BRAVO'),
      incrementalGuild('CHARLIE')
    ]
    mockDirectClient.query.mockResolvedValue({ data: guilds, error: null })
    mockDirectClient.rpc.mockImplementation(
      async (_fn: string, args: Record<string, unknown>) => ({
        data: `job-${args.p_guild_code}`,
        error: null
      })
    )

    const result = await syncSchedulerHandler({}, context)

    expect(result).toMatchObject({ scheduled: 3 })
    expect(mockDirectClient.rpc).toHaveBeenCalledTimes(3)
  })

  it('still attempts later guilds when the FIRST guild rejects with 23505', async () => {
    const guilds = [
      incrementalGuild('DUPE'),
      incrementalGuild('ALPHA'),
      incrementalGuild('BRAVO')
    ]
    mockDirectClient.query.mockResolvedValue({ data: guilds, error: null })
    mockDirectClient.rpc.mockImplementation(
      async (_fn: string, args: Record<string, unknown>) => {
        if (args.p_guild_code === 'DUPE') {
          return { data: null, error: 'HTTP 409: {"code":"23505"}' }
        }
        return { data: `job-${args.p_guild_code}`, error: null }
      }
    )

    const result = await syncSchedulerHandler({}, context)

    expect(mockDirectClient.rpc).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ scheduled: 2 })
  })
})

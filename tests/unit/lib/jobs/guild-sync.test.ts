import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A Herald crash for one guild must not abort the sync fan-out for the rest. */

type Handler = (
  payload: Record<string, unknown>,
  context: { jobId: number; workerId: string; attempts: number }
) => Promise<Record<string, unknown> | void>

const context = { jobId: 7, workerId: 'vitest', attempts: 1 }

type BetaGuild = {
  guild_code: string
  enabled: boolean
  auto_sync_enabled: boolean
  last_successful_sync: string | null
  consecutive_sync_failures: number | null
}

let mockQuery: ReturnType<typeof vi.fn>
let mockInvoke: ReturnType<typeof vi.fn>
let mockRunHerald: ReturnType<typeof vi.fn>
let guildSyncHandler: Handler

function isoSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

function heraldResult(over: Partial<Record<string, number>> = {}) {
  return {
    detected: 0,
    posted: 0,
    deduped: 0,
    availability_detected: 0,
    availability_posted: 0,
    availability_deduped: 0,
    ...over
  }
}

async function loadHandler() {
  const module = await import('@/app/lib/jobs/guild-sync')
  return module.__internal.guildSyncHandler as Handler
}

describe('guild-sync handler', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.SUPABASE_URL = 'http://supabase.local'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    delete process.env.LOKI_SCRAPER_USER_ID // skip bulk PATCH branch for simplicity

    mockQuery = vi.fn()
    mockInvoke = vi.fn().mockResolvedValue({
      data: { success: true, stats: { finalValidEntries: 3 } },
      error: null
    })
    mockRunHerald = vi.fn().mockResolvedValue(heraldResult())

    vi.doMock('@/app/lib/network/direct-supabase', () => ({
      createDirectClient: () => ({ query: mockQuery, invoke: mockInvoke })
    }))
    vi.doMock('@/app/lib/db', () => ({
      serviceDb: () => ({ __service: true })
    }))
    vi.doMock('@/app/lib/herald/from-db', () => ({
      runHeraldFromDb: mockRunHerald
    }))
    vi.doMock('@/app/lib/loki/batch-session-refresh', () => ({
      refreshSharedLokiSession: vi
        .fn()
        .mockResolvedValue({ success: false, sessionId: null, durationMs: 1 })
    }))
    vi.doMock('@/app/lib/network/undici-agent', () => ({
      getSharedFetch: () => vi.fn()
    }))
    vi.doMock('@/app/lib/jobs/dispatcher', () => ({
      registerJobHandler: vi.fn()
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('queries guild_config gated on beta_tester=eq.true', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null })

    guildSyncHandler = await loadHandler()
    const result = (await guildSyncHandler({}, context)) as Record<
      string,
      unknown
    >

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('beta_tester=eq.true')
    )
    expect(result.message).toBe('No beta-tester guilds to sync')
  })

  it('filters out disabled / no-auto-sync / failing / fresh guilds', async () => {
    const guilds: BetaGuild[] = [
      {
        guild_code: 'DISABLED',
        enabled: false,
        auto_sync_enabled: true,
        last_successful_sync: null,
        consecutive_sync_failures: 0
      },
      {
        guild_code: 'NOAUTO',
        enabled: true,
        auto_sync_enabled: false,
        last_successful_sync: null,
        consecutive_sync_failures: 0
      },
      {
        guild_code: 'FAILING',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: isoSecondsAgo(120),
        consecutive_sync_failures: 5
      },
      {
        guild_code: 'FRESH',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: isoSecondsAgo(5),
        consecutive_sync_failures: 0
      },
      {
        guild_code: 'STALE',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: isoSecondsAgo(60),
        consecutive_sync_failures: 0
      },
      {
        guild_code: 'NEVER',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: null,
        consecutive_sync_failures: 0
      }
    ]
    mockQuery.mockResolvedValue({ data: guilds, error: null })

    guildSyncHandler = await loadHandler()
    const result = (await guildSyncHandler({}, context)) as Record<
      string,
      number
    >

    const syncedCodes = mockInvoke.mock.calls.map(
      (c) => (c[1] as { guild_code: string }).guild_code
    )
    expect(new Set(syncedCodes)).toEqual(new Set(['STALE', 'NEVER']))
    expect(result.synced).toBe(2)
    expect(result.successful).toBe(2)
  })

  it('does NOT abort edge sync for other guilds when one guild Herald crashes', async () => {
    const guilds: BetaGuild[] = [
      {
        guild_code: 'A',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: isoSecondsAgo(120),
        consecutive_sync_failures: 0
      },
      {
        guild_code: 'B',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: isoSecondsAgo(120),
        consecutive_sync_failures: 0
      },
      {
        guild_code: 'C',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: isoSecondsAgo(120),
        consecutive_sync_failures: 0
      }
    ]
    mockQuery.mockResolvedValue({ data: guilds, error: null })

    mockRunHerald.mockImplementation(async (args: { guildCode: string }) => {
      if (args.guildCode === 'B') {
        throw new Error('Herald exploded for B')
      }
      return heraldResult()
    })

    guildSyncHandler = await loadHandler()
    const result = (await guildSyncHandler({}, context)) as Record<
      string,
      number
    >

    const syncedCodes = mockInvoke.mock.calls
      .map((c) => (c[1] as { guild_code: string }).guild_code)
      .sort()
    expect(syncedCodes).toEqual(['A', 'B', 'C'])
    expect(mockRunHerald).toHaveBeenCalledTimes(3)
    expect(result.synced).toBe(3)
    expect(result.successful).toBe(3)
    expect(result.failed).toBe(0)
  })

  it('marks a guild failed when the edge function reports failure, isolated from peers', async () => {
    const guilds: BetaGuild[] = [
      {
        guild_code: 'GOOD',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: isoSecondsAgo(120),
        consecutive_sync_failures: 0
      },
      {
        guild_code: 'BAD',
        enabled: true,
        auto_sync_enabled: true,
        last_successful_sync: isoSecondsAgo(120),
        consecutive_sync_failures: 0
      }
    ]
    mockQuery.mockResolvedValue({ data: guilds, error: null })
    mockInvoke.mockImplementation(
      async (_fn: string, body: { guild_code: string }) => {
        if (body.guild_code === 'BAD') {
          return { data: { success: false, error: 'sync boom' }, error: null }
        }
        return {
          data: { success: true, stats: { finalValidEntries: 4 } },
          error: null
        }
      }
    )

    guildSyncHandler = await loadHandler()
    const result = (await guildSyncHandler({}, context)) as Record<
      string,
      number
    >

    expect(result.synced).toBe(2)
    expect(result.successful).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.totalEntries).toBe(4)
    expect(mockRunHerald).toHaveBeenCalledTimes(1)
  })

  it('throws when the beta-tester query errors', async () => {
    mockQuery.mockResolvedValue({ data: null, error: 'db down' })

    guildSyncHandler = await loadHandler()
    await expect(guildSyncHandler({}, context)).rejects.toThrow(
      'Failed to fetch beta-tester guilds: db down'
    )
  })

  it('caps the fan-out at 25 guilds, stalest first (WI-4372)', async () => {
    // Fed freshest-first to prove the handler sorts before applying the 25-guild cap.
    const guilds: BetaGuild[] = Array.from({ length: 30 }, (_, i) => ({
      guild_code: `B${String(i + 1).padStart(2, '0')}`,
      enabled: true,
      auto_sync_enabled: true,
      last_successful_sync: isoSecondsAgo(60 + i * 60),
      consecutive_sync_failures: 0
    }))
    mockQuery.mockResolvedValue({ data: guilds, error: null })

    guildSyncHandler = await loadHandler()
    const result = (await guildSyncHandler({}, context)) as Record<
      string,
      number
    >

    expect(mockInvoke).toHaveBeenCalledTimes(25)
    const syncedCodes = mockInvoke.mock.calls.map(
      (c) => (c[1] as { guild_code: string }).guild_code
    )
    expect(syncedCodes).toContain('B30') // stalest included
    for (const fresh of ['B01', 'B03', 'B05']) {
      expect(syncedCodes).not.toContain(fresh)
    }
    expect(syncedCodes).toContain('B06')
    expect(result.eligible).toBe(30)
    expect(result.synced).toBe(25)
  })
})

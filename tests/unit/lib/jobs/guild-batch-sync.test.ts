import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (
  payload: Record<string, unknown>,
  context: { jobId: number; workerId: string; attempts: number }
) => Promise<Record<string, unknown> | void>

const context = { jobId: 4242, workerId: 'vitest', attempts: 1 }

let mockFetch: ReturnType<typeof vi.fn>
let mockEnsure: ReturnType<typeof vi.fn>
let mockCreateStore: ReturnType<typeof vi.fn>
let warnSpy: ReturnType<typeof vi.fn>
let guildBatchSyncHandler: Handler

const ANON = 'anon-key'
const SERVICE = 'service-key'
const BASE = 'http://supabase.local'
const SESSION_STORE = { read: vi.fn(), write: vi.fn() }

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

type GuildRow = {
  guild_code: string
  auto_sync_enabled: boolean | null
  consecutive_sync_failures: number | null
  last_successful_sync: string | null
  sync_tier?: string | null
  guild_id?: string | null
  // Not selected by the healing lane; the mock needs it for the cohort predicate.
  api_key_is_valid?: boolean | null
}

/** Evaluates the healing lane's or=(...) cohort as PostgREST would; supports only `col.is.<v>` / `col.gte.<n>`. */
function applyHealCohort(url: string, rows: GuildRow[]): GuildRow[] {
  const decoded = decodeURIComponent(url)
  const legacy = decoded.includes('api_key_is_valid=is.false')
  const terms = (/[?&]or=\(([^)]*)\)/.exec(decoded)?.[1] ?? '')
    .split(',')
    .filter(Boolean)
  if (!terms.length && !legacy) return rows

  const read = (row: GuildRow, col: string): unknown =>
    (row as Record<string, unknown>)[col]

  return rows.filter((row) => {
    if (legacy) return row.api_key_is_valid === false
    return terms.some((term) => {
      const [col, op, value] = term.split('.')
      if (op === 'gte') return Number(read(row, col) ?? 0) >= Number(value)
      if (op === 'is') {
        if (value === 'null') return read(row, col) == null
        return read(row, col) === (value === 'true')
      }
      throw new Error(`applyHealCohort: unsupported term "${term}"`)
    })
  })
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

function buildFetch(opts: {
  guilds: GuildRow[]
  entriesPerGuild?: number
  throwFor?: Set<string>
  failFor?: Set<string>
  healGuilds?: GuildRow[]
  healFetchFails?: boolean
}) {
  const syncedGuildCodes: string[] = []
  const fn = vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.includes('guild_config') && init && init.body === undefined) {
    }
    if (url.includes('/rest/v1/guild_config?select=')) {
      // Only the healing-lane GET filters on api_key_encrypted, a stable discriminator.
      if (url.includes('api_key_encrypted=not.is.null')) {
        if (opts.healFetchFails)
          return jsonResponse({ err: 'boom' }, false, 500)
        return jsonResponse(applyHealCohort(url, opts.healGuilds ?? []))
      }
      return jsonResponse(opts.guilds) // eligible guild GET
    }
    if (url.includes('/functions/v1/sync-modular-workflow')) {
      const body = JSON.parse(init?.body ?? '{}') as { guild_code: string }
      const code = body.guild_code
      syncedGuildCodes.push(code)
      if (opts.throwFor?.has(code)) {
        throw new Error(`network blew up for ${code}`)
      }
      if (opts.failFor?.has(code)) {
        return jsonResponse({ success: false, error: `sync failed ${code}` })
      }
      return jsonResponse({
        success: true,
        stats: { finalValidEntries: opts.entriesPerGuild ?? 1 }
      })
    }
    return jsonResponse(null)
  })
  return { fn, syncedGuildCodes }
}

async function loadHandler() {
  const module = await import('@/app/lib/jobs/guild-batch-sync')
  return module.__internal.guildBatchSyncHandler as Handler
}

describe('guild-batch-sync handler', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.SUPABASE_URL = BASE
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
    process.env.LOKI_SCRAPER_USER_ID = 'loki-user-123'

    mockFetch = vi.fn()
    mockEnsure = vi.fn().mockResolvedValue({
      sessionId: 'shared-session',
      userId: 'loki-user-123',
      connected: false,
      reused: true,
      durationMs: 12
    })
    mockCreateStore = vi.fn().mockReturnValue(SESSION_STORE)
    warnSpy = vi.fn()

    vi.doMock('@/app/lib/network/undici-agent', () => ({
      getSharedFetch: () => mockFetch
    }))
    vi.doMock('@/app/lib/loki/batch-session-refresh', () => ({
      ensureSharedLokiSession: mockEnsure,
      createRestSharedSessionStore: mockCreateStore
    }))
    vi.doMock('@/app/lib/jobs/dispatcher', () => ({
      registerJobHandler: vi.fn()
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        info: vi.fn(),
        warn: warnSpy,
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
    delete process.env.LOKI_SCRAPER_USER_ID
  })

  it('throws when required Supabase env is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_URL
    mockFetch.mockResolvedValue(jsonResponse(null))

    guildBatchSyncHandler = await loadHandler()
    await expect(guildBatchSyncHandler({}, context)).rejects.toThrow()
  })

  it('applies tier-based stale thresholds (active 1h / warm 4h / dormant 12h)', async () => {
    const guilds: GuildRow[] = [
      {
        guild_code: 'ACTIVE_STALE',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(2),
        sync_tier: 'active'
      },
      {
        guild_code: 'WARM_FRESH',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(2),
        sync_tier: 'warm'
      },
      {
        guild_code: 'DORMANT_STALE',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(13),
        sync_tier: 'dormant'
      },
      {
        guild_code: 'ACTIVE_FRESH',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(0.5),
        sync_tier: 'active'
      }
    ]
    const { fn, syncedGuildCodes } = buildFetch({ guilds })
    mockFetch = fn

    guildBatchSyncHandler = await loadHandler()
    const result = (await guildBatchSyncHandler({}, context)) as Record<
      string,
      number
    >

    expect(new Set(syncedGuildCodes)).toEqual(
      new Set(['ACTIVE_STALE', 'DORMANT_STALE'])
    )
    expect(result.guildsProcessed).toBe(2)
    expect(result.successful).toBe(2)
  })

  it('excludes auto-sync-disabled and >=5-failure guilds, never-synced always qualifies', async () => {
    const guilds: GuildRow[] = [
      {
        guild_code: 'DISABLED',
        auto_sync_enabled: false,
        consecutive_sync_failures: 0,
        last_successful_sync: null
      },
      {
        guild_code: 'TOO_MANY_FAILS',
        auto_sync_enabled: true,
        consecutive_sync_failures: 5,
        last_successful_sync: isoHoursAgo(10),
        sync_tier: 'active'
      },
      {
        guild_code: 'NEVER_SYNCED',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: null
      }
    ]
    const { fn, syncedGuildCodes } = buildFetch({ guilds })
    mockFetch = fn

    guildBatchSyncHandler = await loadHandler()
    await guildBatchSyncHandler({}, context)

    expect(syncedGuildCodes).toEqual(['NEVER_SYNCED'])
  })

  it('caps at MAX_GUILDS_PER_RUN=100 and prioritizes the oldest last_successful_sync', async () => {
    const guilds: GuildRow[] = Array.from({ length: 120 }, (_, i) => ({
      guild_code: `G${String(i).padStart(3, '0')}`,
      auto_sync_enabled: true,
      consecutive_sync_failures: 0,
      last_successful_sync: isoHoursAgo(120 - i * 0.5),
      sync_tier: 'active'
    }))
    const { fn, syncedGuildCodes } = buildFetch({ guilds })
    mockFetch = fn

    const realSetTimeout = globalThis.setTimeout
    const timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      cb: () => void
    ) => {
      cb()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)

    try {
      guildBatchSyncHandler = await loadHandler()
      const result = (await guildBatchSyncHandler({}, context)) as Record<
        string,
        number
      >

      expect(result.guildsPendingSync).toBe(120)
      expect(result.guildsProcessed).toBe(100)
      expect(syncedGuildCodes.length).toBe(100)
      for (let i = 100; i < 120; i++) {
        expect(syncedGuildCodes).not.toContain(`G${String(i).padStart(3, '0')}`)
      }
      expect(syncedGuildCodes).toContain('G000')
    } finally {
      timerSpy.mockRestore()
      globalThis.setTimeout = realSetTimeout
    }
  })

  it('isolates a single throwing guild — only it fails, the batch succeeds', async () => {
    const guilds: GuildRow[] = Array.from({ length: 4 }, (_, i) => ({
      guild_code: `B${i}`,
      auto_sync_enabled: true,
      consecutive_sync_failures: 0,
      last_successful_sync: isoHoursAgo(3),
      sync_tier: 'active'
    }))
    const { fn } = buildFetch({ guilds, throwFor: new Set(['B2']) })
    mockFetch = fn

    guildBatchSyncHandler = await loadHandler()
    const result = (await guildBatchSyncHandler({}, context)) as Record<
      string,
      number
    >

    expect(result.guildsProcessed).toBe(4)
    expect(result.failed).toBe(1)
    expect(result.successful).toBe(3)
  })

  it('sums finalValidEntries only over successful guilds', async () => {
    const guilds: GuildRow[] = [
      {
        guild_code: 'OK1',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(3),
        sync_tier: 'active'
      },
      {
        guild_code: 'BAD',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(3),
        sync_tier: 'active'
      }
    ]
    const { fn } = buildFetch({
      guilds,
      entriesPerGuild: 7,
      failFor: new Set(['BAD'])
    })
    mockFetch = fn

    guildBatchSyncHandler = await loadHandler()
    const result = (await guildBatchSyncHandler({}, context)) as Record<
      string,
      number
    >

    expect(result.successful).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.totalEntries).toBe(7)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ successful: 1, failed: 1, totalEntries: 7 }),
      'guild-batch-sync complete'
    )
  })

  it('warns and sends no session when the shared LOKI session is unavailable', async () => {
    mockEnsure.mockResolvedValue({
      sessionId: null,
      userId: null,
      connected: false,
      reused: false,
      error: 'LOKI CONNECT failed',
      durationMs: 5
    })
    const guilds: GuildRow[] = [
      {
        guild_code: 'ONLY',
        guild_id: 'synthetic-guild-only',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(3),
        sync_tier: 'active'
      }
    ]
    const { fn } = buildFetch({ guilds })
    mockFetch = fn

    guildBatchSyncHandler = await loadHandler()
    const result = (await guildBatchSyncHandler({}, context)) as Record<
      string,
      unknown
    >

    const warnedThunderingHerd = warnSpy.mock.calls.some((call) =>
      String(call[1] ?? '').includes('thundering-herd')
    )
    expect(warnedThunderingHerd).toBe(true)
    expect(result.lokiSharedSession).toBe('none')
    const syncBody = mockFetch.mock.calls
      .filter(([url]) => String(url).includes('sync-modular-workflow'))
      .map(([, init]) => JSON.parse(init.body))
    expect(syncBody).toEqual([{ guild_code: 'ONLY' }])
  })

  it('probes with the stalest guild that has a guild id and hands every sync the shared session', async () => {
    const guilds: GuildRow[] = [
      {
        guild_code: 'NOID',
        guild_id: null,
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(9),
        sync_tier: 'active'
      },
      {
        guild_code: 'NEWER',
        guild_id: 'synthetic-guild-newer',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(2),
        sync_tier: 'active'
      },
      {
        guild_code: 'OLDER',
        guild_id: 'synthetic-guild-older',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(5),
        sync_tier: 'active'
      }
    ]
    const { fn } = buildFetch({ guilds })
    mockFetch = fn

    guildBatchSyncHandler = await loadHandler()
    const result = (await guildBatchSyncHandler({}, context)) as Record<
      string,
      unknown
    >

    const guildGet = String(mockFetch.mock.calls[0]?.[0])
    expect(guildGet).toContain('guild_id')
    expect(mockCreateStore).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: BASE, scraperUserId: 'loki-user-123' })
    )
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledWith({
      store: SESSION_STORE,
      probeGuildId: 'synthetic-guild-older'
    })
    const sessions = mockFetch.mock.calls
      .filter(([url]) => String(url).includes('sync-modular-workflow'))
      .map(([, init]) => {
        const body = JSON.parse(init.body)
        return [body.fresh_session_id, body.fresh_session_user_id]
      })
    expect(sessions).toEqual(Array(3).fill(['shared-session', 'loki-user-123']))
    expect(result.lokiSharedSession).toBe('reused')
  })

  it('asks for no LOKI session when no guild to sync has a guild id', async () => {
    const guilds: GuildRow[] = [
      {
        guild_code: 'NOID',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(3),
        sync_tier: 'active'
      }
    ]
    mockEnsure.mockResolvedValue({
      sessionId: null,
      userId: null,
      connected: false,
      reused: false,
      durationMs: 0
    })
    const { fn } = buildFetch({ guilds })
    mockFetch = fn

    guildBatchSyncHandler = await loadHandler()
    await guildBatchSyncHandler({}, context)

    expect(mockEnsure).toHaveBeenCalledWith(
      expect.objectContaining({ probeGuildId: null })
    )
    const warnedThunderingHerd = warnSpy.mock.calls.some((call) =>
      String(call[1] ?? '').includes('thundering-herd')
    )
    expect(warnedThunderingHerd).toBe(false)
  })

  it('returns the no-op shape when no guilds need syncing', async () => {
    const guilds: GuildRow[] = [
      {
        guild_code: 'FRESH',
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(0.2),
        sync_tier: 'active'
      }
    ]
    const { fn, syncedGuildCodes } = buildFetch({ guilds })
    mockFetch = fn

    guildBatchSyncHandler = await loadHandler()
    const result = (await guildBatchSyncHandler({}, context)) as Record<
      string,
      unknown
    >

    expect(result.message).toBe('No guilds need syncing')
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(result.guildsProcessed).toBe(0)
    expect(syncedGuildCodes.length).toBe(0)
  })

  describe('daily healing lane', () => {
    function flagged(code: string): GuildRow {
      return {
        guild_code: code,
        auto_sync_enabled: false,
        consecutive_sync_failures: 3,
        last_successful_sync: isoHoursAgo(80),
        sync_tier: 'active',
        api_key_is_valid: false
      }
    }
    function healthyStale(code: string): GuildRow {
      return {
        guild_code: code,
        auto_sync_enabled: true,
        consecutive_sync_failures: 0,
        last_successful_sync: isoHoursAgo(2),
        sync_tier: 'active',
        api_key_is_valid: true
      }
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('at 06 UTC re-probes flagged guilds AFTER the normal cohort', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(new Date('2026-08-12T06:15:00.000Z'))
      const { fn, syncedGuildCodes } = buildFetch({
        guilds: [healthyStale('NORMAL1')],
        healGuilds: [flagged('FLAGGED1'), flagged('FLAGGED2')]
      })
      mockFetch = fn
      guildBatchSyncHandler = await loadHandler()
      const result = (await guildBatchSyncHandler({}, context)) as Record<
        string,
        number
      >
      // Within-batch stagger is random, so assert membership and that the unstaggered guild fired first.
      expect(syncedGuildCodes[0]).toBe('NORMAL1')
      expect([...syncedGuildCodes].sort()).toEqual([
        'FLAGGED1',
        'FLAGGED2',
        'NORMAL1'
      ])
      expect(result.guildsProcessed).toBe(3)
    })

    it('outside 06 UTC never issues the healing-lane fetch', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(new Date('2026-08-12T14:15:00.000Z'))
      const { fn, syncedGuildCodes } = buildFetch({
        guilds: [healthyStale('NORMAL1')],
        healGuilds: [flagged('FLAGGED1')]
      })
      mockFetch = fn
      guildBatchSyncHandler = await loadHandler()
      await guildBatchSyncHandler({}, context)
      expect(syncedGuildCodes).toEqual(['NORMAL1'])
      const healCalls = fn.mock.calls.filter(([url]) =>
        String(url).includes('api_key_encrypted=not.is.null')
      )
      expect(healCalls).toHaveLength(0)
    })

    // The healing cohort must be the exact complement of normal-lane eligibility.
    describe('cohort is the complement of normal-lane eligibility', () => {
      function healUrl(fn: { mock: { calls: unknown[][] } }): string {
        const call = fn.mock.calls.find(([url]) =>
          String(url).includes('api_key_encrypted=not.is.null')
        )
        expect(call, 'healing-lane fetch was never issued').toBeDefined()
        return decodeURIComponent(String(call?.[0]))
      }

      /** Parsed terms: substring matching is unsafe (`auto_sync_enabled.is.false` contains `enabled.is.false`). */
      function cohortTerms(fn: { mock: { calls: unknown[][] } }): string[] {
        const match = /[?&]or=\(([^)]*)\)/.exec(healUrl(fn))
        expect(match, 'healing-lane URL carried no or=() cohort').not.toBeNull()
        return (match?.[1] ?? '').split(',')
      }

      it('selects every reason the normal lane drops a keyed guild', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.setSystemTime(new Date('2026-08-12T06:15:00.000Z'))
        const { fn } = buildFetch({ guilds: [healthyStale('NORMAL1')] })
        mockFetch = fn
        guildBatchSyncHandler = await loadHandler()
        await guildBatchSyncHandler({}, context)

        // Exact set: an extra term would resurrect guilds the normal lane is syncing.
        expect(cohortTerms(fn).sort()).toEqual([
          'api_key_is_valid.is.false',
          // Both falsy spellings: `false` is the 3-strike path, `null` was never set.
          'auto_sync_enabled.is.false',
          'auto_sync_enabled.is.null',
          'consecutive_sync_failures.gte.5'
        ])
      })

      it('never resurrects a guild whose owner disabled it', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.setSystemTime(new Date('2026-08-12T06:15:00.000Z'))
        const { fn } = buildFetch({ guilds: [healthyStale('NORMAL1')] })
        mockFetch = fn
        guildBatchSyncHandler = await loadHandler()
        await guildBatchSyncHandler({}, context)
        // `enabled` is the one hand-set disable, so it stays an AND term the healer cannot override.
        expect(healUrl(fn)).toContain('enabled=eq.true')
        expect(
          cohortTerms(fn).filter((term) => /^enabled\./.test(term))
        ).toEqual([])
      })

      it('re-probes the NULL-flag + auto-sync-off dead zone', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.setSystemTime(new Date('2026-08-12T06:15:00.000Z'))
        const deadZone: GuildRow = {
          guild_code: 'DEADZONE1',
          auto_sync_enabled: false,
          consecutive_sync_failures: 0,
          last_successful_sync: isoHoursAgo(80),
          sync_tier: 'active',
          api_key_is_valid: null
        }
        // Never flagged, auto-sync on, but over the failure ceiling: invisible to a flag-only selector.
        const overCeiling: GuildRow = {
          guild_code: 'DEADZONE2',
          auto_sync_enabled: true,
          consecutive_sync_failures: 7,
          last_successful_sync: isoHoursAgo(80),
          sync_tier: 'active',
          api_key_is_valid: true
        }
        // Negative control: a healthy guild must not come back.
        const healthy: GuildRow = {
          ...healthyStale('NOTSTUCK'),
          last_successful_sync: isoHoursAgo(80)
        }
        const { fn, syncedGuildCodes } = buildFetch({
          guilds: [healthyStale('NORMAL1')],
          healGuilds: [deadZone, overCeiling, healthy]
        })
        mockFetch = fn
        guildBatchSyncHandler = await loadHandler()
        await guildBatchSyncHandler({}, context)
        expect(syncedGuildCodes).toContain('DEADZONE1')
        expect(syncedGuildCodes).toContain('DEADZONE2')
        expect(syncedGuildCodes).not.toContain('NOTSTUCK')
      })
    })

    it('a failed healing-lane fetch is non-fatal to the normal batch', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(new Date('2026-08-12T06:15:00.000Z'))
      const { fn, syncedGuildCodes } = buildFetch({
        guilds: [healthyStale('NORMAL1')],
        healFetchFails: true
      })
      mockFetch = fn
      guildBatchSyncHandler = await loadHandler()
      const result = (await guildBatchSyncHandler({}, context)) as Record<
        string,
        number
      >
      expect(syncedGuildCodes).toEqual(['NORMAL1'])
      expect(result.successful).toBe(1)
    })
  })
})

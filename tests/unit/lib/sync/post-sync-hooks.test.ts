import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/sync/api-operations', () => ({
  fetchGuildMembersViaLoki: vi
    .fn()
    .mockResolvedValue({ members: [], authFailed: false }),
  fetchGuildRankings: vi
    .fn()
    .mockResolvedValue({ guildRaid: null, guildWar: null })
}))

vi.mock('@/app/lib/services/season-timing-service', () => ({
  getSeasonTiming: vi.fn().mockResolvedValue({
    seasonStart: '2024-01-01T00:00:00Z',
    seasonEnd: '2024-01-14T00:00:00Z',
    seasonNumber: 1,
    weekNumber: 1
  })
}))

// Null for NULL/plaintext fixtures so the env scraper-cred fallback runs.
vi.mock('@tacticus/app-core/encryption', () => ({
  resolveStoredSecret: vi.fn(async (s: string | null | undefined) => s ?? null)
}))

import {
  runPostSyncHooks,
  checkSeasonCoverage
} from '@/app/lib/sync/post-sync-hooks'
import type { GuildConfig } from '@tacticus/app-core/types'

function buildMockSupabase(overrides: Record<string, any> = {}) {
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const chainable: Record<string, any> = {
    select: () => chainable,
    eq: () => chainable,
    gte: () => chainable,
    in: () => chainable,
    single: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    delete: () => chainable,
    update: () => chainable,
    order: () => chainable
  }

  return {
    rpc: vi.fn((fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: null, error: null })
    }),
    from: vi.fn(() => ({
      ...chainable,
      ...overrides
    })),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null })
    },
    _rpcCalls: rpcCalls
  } as any
}

describe('runPostSyncHooks', () => {
  const baseConfig = {
    guild_code: 'GUILD01',
    cluster_code: 'C1',
    guild_id: null,
    user_id: null,
    session_id: null,
    client_secret: null
  } as unknown as GuildConfig

  it('updates token burn and delegates ranking throttling to the database RPC', async () => {
    const supabase = buildMockSupabase()
    await runPostSyncHooks('GUILD01', '5', baseConfig, supabase)

    expect(supabase.rpc).toHaveBeenCalledWith(
      'update_token_burn_state_for_guild',
      expect.objectContaining({ p_guild_code: 'GUILD01', p_season: '5' })
    )
    expect(supabase.rpc).toHaveBeenCalledWith('refresh_cluster_rankings')
  })

  it('requests a database-throttled rankings refresh after every sync', async () => {
    const supabase = buildMockSupabase()

    await runPostSyncHooks('GUILD01', '5', baseConfig, supabase)
    await runPostSyncHooks('GUILD01', '5', baseConfig, supabase)

    expect(supabase.rpc).toHaveBeenCalledWith('refresh_cluster_rankings')
    expect(
      supabase._rpcCalls.filter(
        ({ fn }: { fn: string }) => fn === 'refresh_cluster_rankings'
      )
    ).toHaveLength(2)
  })

  it('keeps a returned rankings RPC error non-fatal', async () => {
    const supabase = buildMockSupabase()
    supabase.rpc.mockImplementation(
      (fn: string, args?: Record<string, unknown>) => {
        supabase._rpcCalls.push({ fn, args })
        return Promise.resolve(
          fn === 'refresh_cluster_rankings'
            ? { data: null, error: { message: 'refresh failed' } }
            : { data: null, error: null }
        )
      }
    )

    await runPostSyncHooks('GUILD01', '5', baseConfig, supabase)

    expect(supabase.rpc).toHaveBeenCalledWith('refresh_cluster_rankings')
  })

  it('fires Discord leaderboard edge function', async () => {
    const supabase = buildMockSupabase()
    await runPostSyncHooks('GUILD01', '5', baseConfig, supabase)

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'update-discord-leaderboards?guild=GUILD01',
      { body: { cluster_code: 'C1' } }
    )
  })

  it('fires season calendar upsert', async () => {
    const supabase = buildMockSupabase()
    await runPostSyncHooks('GUILD01', '5', baseConfig, supabase)

    expect(supabase.from).toHaveBeenCalledWith('season_calendar')
  })

  it('does not crash when token burn RPC fails', async () => {
    const supabase = buildMockSupabase()
    supabase.rpc.mockRejectedValueOnce(new Error('token burn failed'))
    await runPostSyncHooks('GUILD01', '5', baseConfig, supabase)
  })

  it('skips LOKI hooks when guild lacks LOKI credentials', async () => {
    const supabase = buildMockSupabase()
    await runPostSyncHooks('GUILD01', '5', baseConfig, supabase)

    const { fetchGuildMembersViaLoki } =
      await import('@/app/lib/sync/api-operations')
    expect(fetchGuildMembersViaLoki).not.toHaveBeenCalled()
  })
})

describe('runPostSyncHooks — LOKI deactivation guard (BUG-2, WI-1795)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'server-loki-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const lokiConfig = {
    guild_code: 'GUILD01',
    cluster_code: 'C1',
    guild_id: 'g-123',
    user_id: 'u-123',
    session_id: 's-123',
    client_secret: 'secret'
  } as unknown as GuildConfig

  function buildLokiMockSupabase(opts: {
    activeUserIds: Array<{ userId: string }>
    currentPlayers: Array<{ player_id: string; guild_code: string }>
  }) {
    const deactivatedIds: string[][] = []

    function makeThenable(result: Record<string, unknown>) {
      // Chainable and awaitable; `.in` is terminal (savePlayerMappings uses it).
      const chain: Record<string, unknown> = {
        eq: () => chain,
        gte: () => chain,
        order: () => chain,
        select: () => chain,
        or: () => chain,
        in: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve)
      }
      return chain
    }

    const supabase = {
      rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
        if (name === 'deactivate_player_mappings_observed') {
          const ids = (args?.p_player_ids ?? []) as string[]
          deactivatedIds.push(ids)
          return Promise.resolve({
            data: {
              success: true,
              guild_code: args?.p_guild_code,
              requested_count: ids.length,
              deactivated_count: ids.length,
              observation_stale: false,
              deactivated_mapping_ids: ids.map((_, index) => index + 1),
              revoked_attestations: 0,
              purged_loki_credential_count: 0,
              purged_loki_guild_codes: [],
              authority_cleared: true
            },
            error: null
          })
        }
        return Promise.resolve({ data: null, error: null })
      }),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      },
      from: vi.fn((table: string) => {
        if (table === 'EOT_GR_data') {
          return {
            select: () =>
              makeThenable({ data: opts.activeUserIds, error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: () =>
              makeThenable({ data: opts.currentPlayers, error: null }),
            upsert: () => Promise.resolve({ data: null, error: null }),
            update: () => ({
              in: () => Promise.resolve({ data: null, error: null }),
              eq: () => Promise.resolve({ data: null, error: null })
            })
          }
        }
        const noop: Record<string, unknown> = {
          select: () => noop,
          eq: () => noop,
          gte: () => noop,
          order: () => noop,
          or: () => noop,
          in: () => Promise.resolve({ data: null, error: null }),
          update: () => noop,
          upsert: () => Promise.resolve({ data: null, error: null }),
          delete: () => noop,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve)
        }
        return noop
      })
    } as any

    return { supabase, deactivatedIds }
  }

  it('Case A: spares an active member X absent from the LOKI roster', async () => {
    const { fetchGuildMembersViaLoki } =
      await import('@/app/lib/sync/api-operations')
    vi.mocked(fetchGuildMembersViaLoki).mockResolvedValueOnce({
      members: [{ userId: 'A', displayName: 'Alice', role: 'member' }],
      authFailed: false
    } as any)

    const { supabase, deactivatedIds } = buildLokiMockSupabase({
      activeUserIds: [{ userId: 'X' }],
      currentPlayers: [
        { player_id: 'A', guild_code: 'GUILD01' },
        { player_id: 'X', guild_code: 'GUILD01' }
      ]
    })

    await runPostSyncHooks('GUILD01', '5', lokiConfig, supabase)

    const allDeactivated = deactivatedIds.flat()
    expect(allDeactivated).not.toContain('X')
  })

  it('Case B: deactivates member Y absent from roster AND not recently active', async () => {
    const { fetchGuildMembersViaLoki } =
      await import('@/app/lib/sync/api-operations')
    vi.mocked(fetchGuildMembersViaLoki).mockResolvedValueOnce({
      members: [{ userId: 'A', displayName: 'Alice', role: 'member' }],
      authFailed: false
    } as any)

    const { supabase, deactivatedIds } = buildLokiMockSupabase({
      activeUserIds: [], // nobody recently active
      currentPlayers: [
        { player_id: 'A', guild_code: 'GUILD01' },
        { player_id: 'Y', guild_code: 'GUILD01' }
      ]
    })

    await runPostSyncHooks('GUILD01', '5', lokiConfig, supabase)

    const allDeactivated = deactivatedIds.flat()
    expect(allDeactivated).toContain('Y')
    expect(allDeactivated).not.toContain('A')
  })
})

describe('runPostSyncHooks — D1 scraper-cohort credential gate (WI-1795)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Scraper-cohort guild with NULL user credentials; LOKI backfill must still run.
  const scraperConfig = {
    guild_code: 'SCRAPER1',
    cluster_code: 'C1',
    cluster_id: 'cl-1',
    guild_id: 'g-scraper',
    user_id: null,
    session_id: null,
    client_secret: null
  } as unknown as GuildConfig

  function buildBareMockSupabase() {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      or: () => chain,
      in: () => Promise.resolve({ data: [], error: null }),
      update: () => ({
        in: () => Promise.resolve({ data: null, error: null }),
        eq: () => Promise.resolve({ data: null, error: null })
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      delete: () => chain,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve)
    }
    return {
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      },
      from: vi.fn(() => chain)
    } as any
  }

  it('runs the LOKI backfill for a NULL-cred scraper guild via env scraper fallback', async () => {
    vi.stubEnv('LOKI_SCRAPER_USER_ID', 'env-scraper-uid')
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'env-scraper-secret')

    const { fetchGuildMembersViaLoki } =
      await import('@/app/lib/sync/api-operations')
    vi.mocked(fetchGuildMembersViaLoki).mockResolvedValueOnce({
      members: [],
      authFailed: false
    } as any)

    await runPostSyncHooks(
      'SCRAPER1',
      '5',
      scraperConfig,
      buildBareMockSupabase()
    )

    expect(fetchGuildMembersViaLoki).toHaveBeenCalledWith(
      'SCRAPER1',
      'g-scraper',
      'env-scraper-uid',
      '',
      'env-scraper-secret',
      expect.anything()
    )
  })

  it('uses the env scraper user id even when the row carries a legacy user_id', async () => {
    // A legacy user_id with the shared scraper secret gets HTTP 500 from LOKI, freezing the roster.
    vi.stubEnv('LOKI_SCRAPER_USER_ID', 'env-scraper-uid')
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'env-scraper-secret')

    const { fetchGuildMembersViaLoki } =
      await import('@/app/lib/sync/api-operations')
    vi.mocked(fetchGuildMembersViaLoki).mockResolvedValueOnce({
      members: [],
      authFailed: false
    } as any)

    const legacyConfig = {
      ...scraperConfig,
      guild_code: 'LEGACY1',
      user_id: 'legacy-per-guild-uid',
      session_id: 's-legacy'
    } as unknown as GuildConfig

    const legacySupabase = buildBareMockSupabase()
    const legacyUpdates: Record<string, unknown>[] = []
    const bareFrom = legacySupabase.from
    legacySupabase.from = vi.fn((table: string) => {
      const chain = bareFrom(table)
      if (table !== 'guild_config') return chain
      return {
        ...chain,
        update: (payload: Record<string, unknown>) => {
          legacyUpdates.push(payload)
          return { eq: () => Promise.resolve({ data: null, error: null }) }
        }
      }
    })

    await runPostSyncHooks('LEGACY1', '5', legacyConfig, legacySupabase)

    // The legacy session must not be reused under the scraper identity.
    expect(fetchGuildMembersViaLoki).toHaveBeenCalledWith(
      'LEGACY1',
      'g-scraper',
      'env-scraper-uid',
      '',
      'env-scraper-secret',
      expect.anything()
    )
    // The legacy credential clears together: a trigger refuses NULL user_id while client_secret remains.
    expect(legacyUpdates).toContainEqual(
      expect.objectContaining({
        user_id: null,
        session_id: null,
        client_secret: null,
        client_secret_uploaded_by: null,
        client_secret_uploaded_at: null
      })
    )
  })

  it('still skips LOKI when NO row creds AND no env scraper creds exist', async () => {
    vi.stubEnv('LOKI_SCRAPER_USER_ID', '')
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', '')

    const { fetchGuildMembersViaLoki } =
      await import('@/app/lib/sync/api-operations')

    await runPostSyncHooks(
      'SCRAPER1',
      '5',
      scraperConfig,
      buildBareMockSupabase()
    )

    expect(fetchGuildMembersViaLoki).not.toHaveBeenCalled()
  })
})

describe('runPostSyncHooks — LOKI roster disambiguation (WI-499)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'server-loki-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const lokiConfig = {
    guild_code: 'GUILD01',
    cluster_code: 'C1',
    guild_id: 'g-123',
    user_id: 'u-123',
    session_id: 's-123'
  } as unknown as GuildConfig

  function buildCapturingSupabase() {
    const upserted: Array<Record<string, unknown>> = []
    function thenable(result: Record<string, unknown>) {
      const chain: Record<string, unknown> = {
        eq: () => chain,
        gte: () => chain,
        select: () => chain,
        or: () => chain,
        order: () => chain,
        in: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve)
      }
      return chain
    }
    const supabase = {
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      },
      from: vi.fn((table: string) => {
        if (table === 'EOT_GR_data') {
          return { select: () => thenable({ data: [], error: null }) }
        }
        if (table === 'player_mapping') {
          return {
            select: () => thenable({ data: [], error: null }),
            upsert: (rows: Array<Record<string, unknown>>) => {
              upserted.push(...rows)
              return Promise.resolve({ data: null, error: null })
            },
            update: () => ({
              in: () => Promise.resolve({ data: null, error: null }),
              eq: () => Promise.resolve({ data: null, error: null })
            })
          }
        }
        const noop: Record<string, unknown> = {
          select: () => noop,
          eq: () => noop,
          gte: () => noop,
          order: () => noop,
          or: () => noop,
          in: () => Promise.resolve({ data: null, error: null }),
          update: () => noop,
          upsert: () => Promise.resolve({ data: null, error: null }),
          delete: () => noop,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve)
        }
        return noop
      })
    } as any
    return { supabase, upserted }
  }

  it('disambiguates duplicate LOKI names instead of writing them raw', async () => {
    // The suffix is a join key and the marker gates the claim-consume fallback, so neither may be erased.
    const { fetchGuildMembersViaLoki } =
      await import('@/app/lib/sync/api-operations')
    vi.mocked(fetchGuildMembersViaLoki).mockResolvedValueOnce({
      members: [
        { userId: 'B2', displayName: 'Bob', role: 'member' },
        { userId: 'B1', displayName: 'Bob', role: 'member' },
        { userId: 'A1', displayName: 'Alice', role: 'member' }
      ],
      authFailed: false
    } as any)

    const { supabase, upserted } = buildCapturingSupabase()
    await runPostSyncHooks('GUILD01', '1', lokiConfig, supabase)

    const bobs = upserted.filter((row) => row.original_display_name === 'Bob')
    expect(bobs).toHaveLength(2)
    for (const row of bobs) {
      expect(row.has_duplicate_name).toBe(true)
      expect(row.display_name).not.toBe('Bob')
    }
    // userId-sorted numbering, shared with the other roster writers so they converge.
    expect(bobs.map((row) => [row.player_id, row.display_name]).sort()).toEqual(
      [
        ['B1', 'Bob (GUILD01_01)'],
        ['B2', 'Bob (GUILD01_02)']
      ]
    )

    const alice = upserted.find((row) => row.player_id === 'A1')
    expect(alice?.display_name).toBe('Alice')
    expect(alice?.has_duplicate_name).toBe(false)
    expect(alice?.original_display_name).toBeNull()
  })
})

describe('checkSeasonCoverage', () => {
  function fixture(
    seasons: number[],
    options: {
      readError?: boolean
      enqueueError?: string
      completed?: boolean
    } = {}
  ) {
    const inserted: any[] = []
    const deleted: Array<Record<string, string>> = []
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: seasons,
        error: options.readError ? { message: 'unavailable' } : null
      }),
      from: vi.fn((table: string) => {
        if (table === 'work_queue') {
          const query: any = {
            select: () => query,
            eq: () => query,
            limit: () => query,
            maybeSingle: async () => ({
              data: options.completed ? { id: 'done' } : null,
              error: null
            }),
            insert: async (row: any) => {
              inserted.push(row)
              return {
                error: options.enqueueError
                  ? { code: options.enqueueError }
                  : null
              }
            }
          }
          return query
        }
        if (table === 'EOT_GR_data') {
          const filters: Record<string, string> = {}
          const query: any = {
            delete: () => query,
            eq: (key: string, value: string) => {
              filters[key] = value
              return query
            },
            then: (resolve: any) => {
              deleted.push(filters)
              return Promise.resolve({
                error: null
              }).then(resolve)
            }
          }
          return query
        }
        throw new Error('Unexpected table')
      })
    } as any
    return { supabase, inserted, deleted }
  }

  it('queues explicit recent historical seasons rather than another current-season sync', async () => {
    const f = fixture([10, 9])
    await checkSeasonCoverage('GUILD01', 10, f.supabase)
    expect(f.supabase.rpc).toHaveBeenCalledWith(
      'get_distinct_seasons_for_guild',
      { p_guild: 'GUILD01' }
    )
    expect(f.inserted).toHaveLength(1)
    expect(f.inserted[0]).toMatchObject({
      job_type: 'guild_historical_backfill',
      job_class: 'batch',
      payload: { guild_code: 'GUILD01', force_seasons: [8, 7, 6, 5] }
    })
    expect(new Date(f.inserted[0].scheduled_for).getTime()).toBeGreaterThan(
      Date.now()
    )
    expect(f.supabase.rpc).not.toHaveBeenCalledWith(
      'enqueue_sync',
      expect.anything()
    )
  })

  it('detects recent gaps even with many older populated seasons', async () => {
    const f = fixture([30, 29, 27, 26, 25, 24, 23, 22, 21])
    await checkSeasonCoverage('GUILD01', 30, f.supabase)
    expect(f.inserted[0].payload.force_seasons).toEqual([28])
  })

  it('does not queue complete recent coverage', async () => {
    const f = fixture([10, 9, 8, 7, 6, 5])
    await checkSeasonCoverage('GUILD01', 10, f.supabase)
    expect(f.inserted).toHaveLength(0)
  })

  it('does not replay a completed empty-season probe every poll', async () => {
    const f = fixture([10], { completed: true })
    await checkSeasonCoverage('GUILD01', 10, f.supabase)
    expect(f.inserted).toHaveLength(0)
  })

  it('leaves an existing active deduplicated job alone', async () => {
    const f = fixture([10], { enqueueError: '23505' })
    await expect(
      checkSeasonCoverage('GUILD01', 10, f.supabase)
    ).resolves.toBeUndefined()
  })

  it.each([{ readError: true }, { enqueueError: 'XX000' }])(
    'fails for retry when history cannot be discovered or queued: %j',
    async (options) => {
      const f = fixture([10], options)
      await expect(
        checkSeasonCoverage('GUILD01', 10, f.supabase)
      ).rejects.toThrow()
      expect(f.deleted).toHaveLength(0)
    }
  )

  it('never deletes old seasons, however far back they go', async () => {
    const f = fixture([30, 29, 28, 27, 26, 25, 10, 9, 1])
    await checkSeasonCoverage('GUILD01', 30, f.supabase)
    expect(f.deleted).toHaveLength(0)
  })
})

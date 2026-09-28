import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const mockDecryptApiKey = vi.fn().mockResolvedValue('test-api-key')
vi.mock('@tacticus/app-core/encryption', () => ({
  decryptApiKey: (...args: readonly unknown[]) => mockDecryptApiKey(...args)
}))

vi.mock('@/app/lib/errors/AppError', () => ({
  Errors: {
    fromResponse: vi.fn((status: number, body: object) =>
      Object.assign(new Error('AppError'), {
        statusCode: status,
        body,
        isAppError: true
      })
    )
  },
  rethrowIfAppError: vi.fn((err: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.isAppError) throw err
  })
}))

vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: vi.fn()
}))

const mockFetchTacticusApi = vi.fn()
vi.mock('@/app/lib/sync/tacticus-api-client', () => ({
  fetchTacticusApi: (...args: readonly unknown[]) =>
    mockFetchTacticusApi(...args)
}))

vi.mock('@/app/lib/sync/post-sync-hooks', () => ({
  runPostSyncHooks: vi.fn().mockResolvedValue(undefined),
  checkSeasonCoverage: vi.fn().mockResolvedValue(undefined)
}))

const mockExtractEntries = vi.fn(() => [])
const mockSanitizeRaidEntries = vi.fn((entries: readonly unknown[]) => ({
  sanitized: entries,
  dropped: 0
}))
const mockProcessRaidEntry = vi.fn((_entry, guild, season) => ({
  Guild: guild,
  Season: season,
  Name: 'player1'
}))
const mockFilterProcessedData = vi.fn((entries: readonly unknown[]) => entries)

// Partial mock: the display-name dedup suffix is a join key, so it stays real.
vi.mock('@/app/lib/sync/transformers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/sync/transformers')>()),
  extractEntries: (...args: readonly unknown[]) => mockExtractEntries(...args),
  sanitizeRaidEntries: (...args: readonly unknown[]) =>
    mockSanitizeRaidEntries(...args),
  processRaidEntry: (...args: readonly unknown[]) =>
    mockProcessRaidEntry(...args),
  filterProcessedData: (...args: readonly unknown[]) =>
    mockFilterProcessedData(...args)
}))

// Plain functions, not vi.fn(): clearAllMocks drops the mockResolvedValue returns the pipeline needs.
vi.mock('@/app/lib/sync/db-operations', () => ({
  loadExistingPlayerMappings: () => Promise.resolve(new Map()),
  fetchBossMappings: () => Promise.resolve(new Map()),
  updateBombTracking: () => Promise.resolve(undefined)
}))

import { processJob } from '@/app/lib/sync/sync-worker-service'
import type { SyncJob } from '@/app/lib/sync/worker-types'

function buildRpcMock(
  overrides: Record<string, (args?: Record<string, unknown>) => unknown> = {}
) {
  const calls: Record<string, Array<Record<string, unknown> | undefined>> = {}
  const impl = (fn: string, args?: Record<string, unknown>) => {
    ;(calls[fn] ??= []).push(args)
    if (overrides[fn]) return overrides[fn](args)
    return Promise.resolve({ data: null, error: null })
  }
  return { impl, calls }
}

function buildFromMock(
  tableOverrides: Record<string, Record<string, unknown>> = {}
) {
  return (table: string) => {
    const overrides = tableOverrides[table] ?? {}
    const chainable: Record<string, unknown> = {
      select: () => chainable,
      eq: () => chainable,
      gte: () => chainable,
      lte: () => chainable,
      like: () => chainable,
      in: () => chainable,
      single: () =>
        Promise.resolve({
          data: overrides.singleData ?? null,
          error: overrides.singleError ?? null
        }),
      maybeSingle: () =>
        Promise.resolve({
          data: overrides.maybeSingleData ?? null,
          error: null
        }),
      upsert: () => {
        const configuredUpsertData = overrides.upsertData
        const upsertResult = {
          data:
            typeof configuredUpsertData === 'function'
              ? configuredUpsertData()
              : Object.hasOwn(overrides, 'upsertData')
                ? configuredUpsertData
                : null,
          error: overrides.upsertError ?? null
        }
        return {
          select: () => Promise.resolve(upsertResult),
          then: (resolve: (v: typeof upsertResult) => unknown) =>
            resolve(upsertResult)
        }
      },
      delete: () => chainable,
      update: () => chainable,
      insert: () => chainable,
      order: () => chainable,
      not: () => Promise.resolve({ error: overrides.deleteError ?? null })
    }
    return chainable
  }
}

type TableCall = {
  table: string
  operation: string
  args: readonly unknown[]
}

function buildRecordingFromMock(
  tableOverrides: Record<string, Record<string, unknown>> = {}
) {
  const calls: TableCall[] = []
  const from = vi.fn((table: string) => {
    const overrides = tableOverrides[table] ?? {}
    const chainResult = {
      data: overrides.selectData ?? null,
      error: overrides.selectError ?? null
    }
    const chainable: Record<string, unknown> = {
      select: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'select', args })
        return chainable
      },
      eq: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'eq', args })
        return chainable
      },
      gte: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'gte', args })
        return chainable
      },
      // Tombstone reads use `.like()` before `.in()`; a missing `like` aborts the raid sync.
      like: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'like', args })
        return chainable
      },
      lte: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'lte', args })
        return chainable
      },
      lt: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'lt', args })
        return Promise.resolve({ error: overrides.deleteError ?? null })
      },
      in: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'in', args })
        return Promise.resolve({ error: overrides.deleteError ?? null })
      },
      single: () =>
        Promise.resolve({
          data: overrides.singleData ?? null,
          error: overrides.singleError ?? null
        }),
      maybeSingle: () => {
        calls.push({ table, operation: 'maybeSingle', args: [] })
        return Promise.resolve({
          data: overrides.maybeSingleData ?? null,
          error: null
        })
      },
      then: (resolve: (v: typeof chainResult) => unknown) =>
        resolve(chainResult),
      upsert: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'upsert', args })
        const configuredUpsertData = overrides.upsertData
        const upsertResult = {
          data: overrides.upsertError
            ? null
            : typeof configuredUpsertData === 'function'
              ? configuredUpsertData()
              : Object.hasOwn(overrides, 'upsertData')
                ? configuredUpsertData
                : [{ id: 1 }],
          error: overrides.upsertError ?? null
        }
        return {
          select: (...selectArgs: readonly unknown[]) => {
            calls.push({ table, operation: 'upsert.select', args: selectArgs })
            return Promise.resolve(upsertResult)
          },
          then: (resolve: (v: typeof upsertResult) => unknown) =>
            resolve(upsertResult)
        }
      },
      delete: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'delete', args })
        return chainable
      },
      not: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'not', args })
        return Promise.resolve({ error: overrides.deleteError ?? null })
      },
      update: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'update', args })
        return chainable
      },
      insert: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'insert', args })
        return {
          select: () => {
            calls.push({ table, operation: 'insert.select', args: [] })
            return Promise.resolve({
              data: overrides.insertData ?? [
                { lock_key: 'gr_sync_C1_GUILD01' }
              ],
              error: overrides.insertError ?? null
            })
          }
        }
      },
      order: (...args: readonly unknown[]) => {
        calls.push({ table, operation: 'order', args })
        return chainable
      }
    }
    return chainable
  })

  return { from, calls }
}

const mockGuildConfig = {
  guild_code: 'GUILD01',
  api_key_encrypted: 'encrypted-key',
  cluster_code: 'C1',
  cluster_id: 'cluster-1'
}

describe('processJob', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    mockDecryptApiKey.mockResolvedValue('test-api-key')
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, currentSeason: 1, entries: [] })
    })
    mockExtractEntries.mockReturnValue([])
    mockSanitizeRaidEntries.mockImplementation(
      (entries: readonly unknown[]) => ({ sanitized: entries, dropped: 0 })
    )
    mockProcessRaidEntry.mockImplementation((_entry, guild, season) => ({
      Guild: guild,
      Season: season,
      Name: 'player1'
    }))
    mockFilterProcessedData.mockImplementation(
      (entries: readonly unknown[]) => entries
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('routes validation_sync to validation handler (no API key needed)', async () => {
    const rpc = buildRpcMock({
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: vi.fn(
        buildFromMock({
          guild_config: { singleData: mockGuildConfig },
          EOT_GR_data: {}
        })
      ),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'validation_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    expect(result.success).toBe(true)
    expect(rpc.calls['complete_job']).toBeDefined()
  })

  it('permanently fails job when guild config is not found (PGRST116)', async () => {
    const rpc = buildRpcMock({
      fail_job: () => Promise.resolve({ data: true, error: null })
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: vi.fn(
        buildFromMock({
          guild_config: {
            singleError: { code: 'PGRST116', message: 'Not found' }
          },
          sync_queue: {}
        })
      ),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'MISSING',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    expect(result.success).toBe(false)
    expect(rpc.calls['fail_job']).toBeDefined()
    const failArgs = rpc.calls['fail_job']![0]!
    expect(failArgs['p_error']).toContain('permanent')
  })

  it('routes player_sync to player handler', async () => {
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ members: [{ userId: 'p1', displayName: 'Player1' }] })
    })

    const rpc = buildRpcMock({
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: vi.fn(
        buildFromMock({
          guild_config: { singleData: mockGuildConfig },
          player_mapping: {}
        })
      ),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'player_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    expect(result.success).toBe(true)
    expect(result.playersUpdated).toBe(1)
    expect(rpc.calls['complete_job']).toBeDefined()
  })

  it('player_sync whose only roster upsert fails records the failure and calls fail_job', async () => {
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          members: [{ userId: 'player-a', displayName: 'TestPlayerA' }]
        })
    })

    const rpc = buildRpcMock({
      fail_job: () => Promise.resolve({ data: true, error: null }),
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: vi.fn(
        buildFromMock({
          guild_config: { singleData: mockGuildConfig },
          player_mapping: {
            upsertError: { message: 'permission denied for table' }
          }
        })
      ),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'player_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    expect(result.success).toBe(false)
    expect(result.playersUpdated).toBe(0)
    expect(result.upsertFailures).toBe(1)
    expect(rpc.calls['complete_job']).toBeUndefined()
    expect(rpc.calls['fail_job']![0]!['p_error']).toContain(
      'Player upsert failed for all 1 member(s)'
    )
    expect(rpc.calls['record_roster_write_outcome']).toEqual([
      expect.objectContaining({
        p_guild_code: 'GUILD01',
        p_ok: false,
        p_rows_written: 0
      })
    ])
  })

  it('full_sync with upsert errors calls fail_job', async () => {
    const mockEntry = {
      Name: 'p1',
      displayName: 'P1',
      userId: 'u1',
      score: 100,
      completedOn: new Date().toISOString()
    }

    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, entries: [mockEntry] })
    })
    mockExtractEntries.mockReturnValue([mockEntry])
    mockSanitizeRaidEntries.mockReturnValue({
      sanitized: [mockEntry],
      dropped: 0
    })
    mockProcessRaidEntry.mockReturnValue({
      Guild: 'GUILD01',
      Season: '1',
      Name: 'p1'
    })
    mockFilterProcessedData.mockImplementation((e) => e)

    const rpc = buildRpcMock({
      fail_job: () => Promise.resolve({ data: true, error: null }),
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: vi.fn(
        buildFromMock({
          guild_config: { singleData: mockGuildConfig },
          EOT_GR_data: {
            upsertError: { message: 'Batch upsert failed: row too large' }
          },
          player_mapping: {}
        })
      ),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    expect(result.success).toBe(false)
    expect(result.upsertFailures).toBeGreaterThan(0)
    expect(rpc.calls['fail_job']).toBeDefined()
    expect(rpc.calls['complete_job']).toBeUndefined()
  })

  it('leaves raid sync unlocked when the Pipeline A lock flag is disabled', async () => {
    const mockEntry = {
      Name: 'p1',
      displayName: 'P1',
      userId: 'u1',
      score: 100,
      completedOn: new Date().toISOString()
    }
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, entries: [mockEntry] })
    })
    mockExtractEntries.mockReturnValue([mockEntry])
    mockSanitizeRaidEntries.mockReturnValue({
      sanitized: [mockEntry],
      dropped: 0
    })
    mockProcessRaidEntry.mockReturnValue({
      Guild: 'GUILD01',
      Season: '1',
      Name: 'p1'
    })

    const rpc = buildRpcMock({
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const recording = buildRecordingFromMock({
      guild_config: { singleData: mockGuildConfig },
      EOT_GR_data: {},
      player_mapping: {}
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: recording.from,
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    expect(result.success).toBe(true)
    expect(recording.from).not.toHaveBeenCalledWith('execution_locks')
    expect(
      recording.calls.some(
        (call) => call.table === 'EOT_GR_data' && call.operation === 'upsert'
      )
    ).toBe(true)
    expect(rpc.calls['complete_job']).toBeDefined()
  })

  it('acquires and releases a Pipeline A execution lock around raid sync', async () => {
    vi.stubEnv('SYNC1_PIPELINE_A_EXECUTION_LOCKS_ENABLED', 'true')
    const mockEntry = {
      Name: 'p1',
      displayName: 'P1',
      userId: 'u1',
      score: 100,
      completedOn: new Date().toISOString()
    }
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, entries: [mockEntry] })
    })
    mockExtractEntries.mockReturnValue([mockEntry])
    mockSanitizeRaidEntries.mockReturnValue({
      sanitized: [mockEntry],
      dropped: 0
    })
    mockProcessRaidEntry.mockReturnValue({
      Guild: 'GUILD01',
      Season: '1',
      Name: 'p1'
    })

    const rpc = buildRpcMock({
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const recording = buildRecordingFromMock({
      guild_config: { singleData: mockGuildConfig },
      // Stale id 99 forces a reconcile-delete, so lock release can be ordered after raid work.
      EOT_GR_data: { selectData: [{ id: 1 }, { id: 99 }] },
      execution_locks: {},
      player_mapping: {}
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: recording.from,
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'worker-a')

    const lockInsert = recording.calls.find(
      (call) => call.table === 'execution_locks' && call.operation === 'insert'
    )
    const lockReleaseIndex = recording.calls.findLastIndex(
      (call) => call.table === 'execution_locks' && call.operation === 'delete'
    )
    const raidDeleteIndex = recording.calls.findIndex(
      (call) => call.table === 'EOT_GR_data' && call.operation === 'in'
    )

    expect(result.success).toBe(true)
    expect(lockInsert?.args[0]).toMatchObject({
      lock_key: 'gr_sync_C1_GUILD01',
      guild_code: 'GUILD01',
      worker_id: 'worker-a'
    })
    expect(raidDeleteIndex).toBeGreaterThan(-1)
    expect(lockReleaseIndex).toBeGreaterThan(raidDeleteIndex)
    expect(rpc.calls['complete_job']).toBeDefined()
  })

  it('defers a claimed raid job when the Pipeline A execution lock is unavailable', async () => {
    vi.stubEnv('SYNC1_PIPELINE_A_EXECUTION_LOCKS_ENABLED', 'true')
    const rpc = buildRpcMock({
      complete_job: () => Promise.resolve({ data: true, error: null }),
      fail_job: () => Promise.resolve({ data: true, error: null })
    })
    const recording = buildRecordingFromMock({
      guild_config: { singleData: mockGuildConfig },
      execution_locks: {
        insertError: {
          message: 'duplicate key value violates unique constraint'
        }
      },
      sync_queue: { singleData: { attempts: 2 } },
      EOT_GR_data: {}
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: recording.from,
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'worker-a')

    const deferUpdate = recording.calls.find(
      (call) => call.table === 'sync_queue' && call.operation === 'update'
    )

    expect(result.success).toBe(false)
    expect(result.errors).toContain('execution_lock_unavailable')
    expect(mockFetchTacticusApi).not.toHaveBeenCalled()
    expect(
      recording.calls.some(
        (call) => call.table === 'EOT_GR_data' && call.operation === 'delete'
      )
    ).toBe(false)
    expect(
      recording.calls.some(
        (call) => call.table === 'EOT_GR_data' && call.operation === 'upsert'
      )
    ).toBe(false)
    expect(deferUpdate?.args[0]).toMatchObject({
      status: 'pending',
      worker_id: null,
      started_at: null,
      attempts: 1,
      progress: {
        deferred: true,
        reason: 'execution_lock_unavailable',
        lock_table: 'execution_locks',
        deferred_by: 'worker-a'
      }
    })
    expect(rpc.calls['complete_job']).toBeUndefined()
    expect(rpc.calls['fail_job']).toBeUndefined()
  })

  it('releases a Pipeline A execution lock when raid sync fails', async () => {
    vi.stubEnv('SYNC1_PIPELINE_A_EXECUTION_LOCKS_ENABLED', 'true')
    const mockEntry = {
      Name: 'p1',
      displayName: 'P1',
      userId: 'u1',
      score: 100,
      completedOn: new Date().toISOString()
    }
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, entries: [mockEntry] })
    })
    mockExtractEntries.mockReturnValue([mockEntry])
    mockSanitizeRaidEntries.mockReturnValue({
      sanitized: [mockEntry],
      dropped: 0
    })
    mockProcessRaidEntry.mockReturnValue({
      Guild: 'GUILD01',
      Season: '1',
      Name: 'p1'
    })

    const rpc = buildRpcMock({
      fail_job: () => Promise.resolve({ data: true, error: null }),
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const recording = buildRecordingFromMock({
      guild_config: { singleData: mockGuildConfig },
      EOT_GR_data: { upsertError: { message: 'row too large' } },
      execution_locks: {},
      player_mapping: {}
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: recording.from,
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'worker-a')

    const lockReleaseIndex = recording.calls.findLastIndex(
      (call) => call.table === 'execution_locks' && call.operation === 'delete'
    )
    const failJobCall = rpc.calls['fail_job']?.[0]

    expect(result.success).toBe(false)
    expect(result.upsertFailures).toBeGreaterThan(0)
    expect(lockReleaseIndex).toBeGreaterThan(-1)
    expect(failJobCall?.p_error).toContain('Batch upsert failed')
    expect(rpc.calls['complete_job']).toBeUndefined()
  })

  // The season delete must never precede a successful upsert, or a transient failure empties the season.
  it('full_sync: never issues an EOT_GR_data delete before a successful upsert (C1)', async () => {
    const mockEntry = {
      Name: 'p1',
      displayName: 'P1',
      userId: 'u1',
      encounterIndex: 0,
      completedOn: new Date().toISOString()
    }
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, entries: [mockEntry] })
    })
    mockExtractEntries.mockReturnValue([mockEntry])
    mockSanitizeRaidEntries.mockReturnValue({
      sanitized: [mockEntry],
      dropped: 0
    })
    mockProcessRaidEntry.mockReturnValue({
      Guild: 'GUILD01',
      Season: '1',
      Name: 'p1'
    })
    mockFilterProcessedData.mockImplementation((e) => e)

    const rpc = buildRpcMock({
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const recording = buildRecordingFromMock({
      guild_config: { singleData: mockGuildConfig },
      EOT_GR_data: { selectData: [{ id: 1 }, { id: 99 }] },
      player_mapping: {}
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: recording.from,
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    const eotCalls = recording.calls.filter((c) => c.table === 'EOT_GR_data')
    const upsertIndex = eotCalls.findIndex((c) => c.operation === 'upsert')
    const deleteIndex = eotCalls.findIndex((c) => c.operation === 'delete')

    expect(result.success).toBe(true)
    expect(deleteIndex).toBeGreaterThan(-1)
    expect(upsertIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(upsertIndex)
    // Keyed on `id`: the tombstone read also issues `.in('userId', ...)` on this table.
    const deleteIn = recording.calls.find(
      (c) =>
        c.table === 'EOT_GR_data' && c.operation === 'in' && c.args[0] === 'id'
    )
    expect(deleteIn?.args).toEqual(['id', [99]])
    expect(
      recording.calls.some(
        (c) => c.table === 'EOT_GR_data' && c.operation === 'not'
      )
    ).toBe(false)
  })

  it('full_sync: issues NO EOT_GR_data delete when an upsert batch fails (C1)', async () => {
    const mockEntry = {
      Name: 'p1',
      displayName: 'P1',
      userId: 'u1',
      encounterIndex: 0,
      completedOn: new Date().toISOString()
    }
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, entries: [mockEntry] })
    })
    mockExtractEntries.mockReturnValue([mockEntry])
    mockSanitizeRaidEntries.mockReturnValue({
      sanitized: [mockEntry],
      dropped: 0
    })
    mockProcessRaidEntry.mockReturnValue({
      Guild: 'GUILD01',
      Season: '1',
      Name: 'p1'
    })
    mockFilterProcessedData.mockImplementation((e) => e)

    const rpc = buildRpcMock({
      fail_job: () => Promise.resolve({ data: true, error: null }),
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const recording = buildRecordingFromMock({
      guild_config: { singleData: mockGuildConfig },
      EOT_GR_data: { upsertError: { message: 'transient upsert failed' } },
      player_mapping: {}
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: recording.from,
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    expect(result.success).toBe(false)
    expect(result.upsertFailures).toBeGreaterThan(0)
    expect(
      recording.calls.some(
        (c) => c.table === 'EOT_GR_data' && c.operation === 'delete'
      )
    ).toBe(false)
    expect(rpc.calls['fail_job']).toBeDefined()
    expect(rpc.calls['complete_job']).toBeUndefined()
  })

  // Over 1000 ids an inline `.not('id','in',...)` overflows the proxy header (414), so deletes chunk.
  it('full_sync: reconciles >1000 ids via bounded .in() chunks, deleting only stale ids (C1)', async () => {
    const writtenIds = Array.from({ length: 1500 }, (_, i) => i + 1)
    const staleIds = Array.from({ length: 700 }, (_, i) => 100_000 + i)
    const writtenEntries = writtenIds.map((id) => ({
      Guild: 'GUILD01',
      Season: '1',
      Name: `p${id}`,
      completedOn: new Date().toISOString()
    }))
    const currentRows = [...writtenIds, ...staleIds].map((id) => ({ id }))

    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, entries: writtenEntries })
    })
    mockExtractEntries.mockReturnValue(writtenEntries)
    mockSanitizeRaidEntries.mockReturnValue({
      sanitized: writtenEntries,
      dropped: 0
    })
    let processIdx = 0
    mockProcessRaidEntry.mockImplementation(() => writtenEntries[processIdx++])
    mockFilterProcessedData.mockImplementation((e) => e)

    const rpc = buildRpcMock({
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    let acknowledgedBatch = 0
    const recording = buildRecordingFromMock({
      guild_config: { singleData: mockGuildConfig },
      EOT_GR_data: {
        upsertData: () => {
          const start = acknowledgedBatch++ * 500
          return writtenIds.slice(start, start + 500).map((id) => ({ id }))
        },
        selectData: currentRows
      },
      player_mapping: {}
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: recording.from,
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'w-1')
    expect(result.success).toBe(true)
    expect(result.upsertFailures).toBe(0)

    expect(
      recording.calls.some(
        (c) => c.table === 'EOT_GR_data' && c.operation === 'not'
      )
    ).toBe(false)

    const inDeleteCalls = recording.calls.filter(
      (c) => c.table === 'EOT_GR_data' && c.operation === 'in'
    )
    expect(inDeleteCalls.length).toBe(2)

    const deletedIds: number[] = []
    for (const call of inDeleteCalls) {
      const [column, chunk] = call.args as [string, number[]]
      expect(column).toBe('id')
      expect(chunk.length).toBeLessThanOrEqual(500)
      deletedIds.push(...chunk)
    }

    expect(new Set(deletedIds)).toEqual(new Set(staleIds))
    expect(deletedIds.some((id) => writtenIds.includes(id))).toBe(false)
    expect(deletedIds.length).toBe(staleIds.length)

    expect(rpc.calls['complete_job']).toBeDefined()
  })

  it('full_sync: a reconcile delete error fails the job so it retries (C1)', async () => {
    const writtenEntries = [
      {
        Guild: 'GUILD01',
        Season: '1',
        Name: 'p1',
        completedOn: new Date().toISOString()
      }
    ]
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ season: 1, entries: writtenEntries })
    })
    mockExtractEntries.mockReturnValue(writtenEntries)
    mockSanitizeRaidEntries.mockReturnValue({
      sanitized: writtenEntries,
      dropped: 0
    })
    mockProcessRaidEntry.mockReturnValue(writtenEntries[0])
    mockFilterProcessedData.mockImplementation((e) => e)

    const rpc = buildRpcMock({
      fail_job: () => Promise.resolve({ data: true, error: null }),
      complete_job: () => Promise.resolve({ data: true, error: null })
    })
    const recording = buildRecordingFromMock({
      guild_config: { singleData: mockGuildConfig },
      EOT_GR_data: {
        upsertData: [{ id: 1 }],
        selectData: [{ id: 1 }, { id: 99 }],
        deleteError: { message: 'reconcile chunk DELETE failed (transient)' }
      },
      player_mapping: {}
    })
    const supabase = {
      rpc: vi.fn(rpc.impl),
      from: recording.from,
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    } as any

    const job: SyncJob = {
      id: 'j1',
      guild_code: 'GUILD01',
      job_type: 'full_sync'
    }
    const result = await processJob(job, supabase, 'w-1')

    expect(result.success).toBe(false)
    expect(result.upsertFailures).toBe(1)
    expect(
      result.errors.some((e) => e.includes('reconcile delete failed'))
    ).toBe(true)
    expect(rpc.calls['fail_job']).toBeDefined()
    expect(rpc.calls['complete_job']).toBeUndefined()
  })

  // One 401/403 must not invalidate the key: the gateway returns 403 for burst throttling too.
  describe('auth-failure strikes', () => {
    async function runAuth403Job(consecutiveFailures: number) {
      const { TacticusApiError } = await import('@/app/lib/sync/worker-types')
      mockFetchTacticusApi.mockRejectedValue(
        new TacticusApiError(403, 'GUILD01')
      )
      const rpc = buildRpcMock({
        fail_job: () => Promise.resolve({ data: true, error: null })
      })
      const { from, calls } = buildRecordingFromMock({
        guild_config: {
          singleData: mockGuildConfig,
          maybeSingleData: { consecutive_sync_failures: consecutiveFailures }
        },
        sync_queue: {}
      })
      const supabase = {
        rpc: vi.fn(rpc.impl),
        from,
        functions: {
          invoke: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      } as any
      const job: SyncJob = {
        id: 'j-403',
        guild_code: 'GUILD01',
        job_type: 'player_sync'
      }
      const result = await processJob(job, supabase, 'w-1')
      const guildConfigUpdates = calls
        .filter((c) => c.table === 'guild_config' && c.operation === 'update')
        .map((c) => c.args[0] as Record<string, unknown>)
      return { result, guildConfigUpdates }
    }

    it('first 403 increments the strike counter without invalidating the key', async () => {
      const { result, guildConfigUpdates } = await runAuth403Job(0)
      expect(result.success).toBe(false)
      expect(guildConfigUpdates).toHaveLength(1)
      expect(guildConfigUpdates[0]).toEqual({ consecutive_sync_failures: 1 })
      expect(guildConfigUpdates[0]).not.toHaveProperty('api_key_is_valid')
    })

    it('third consecutive 403 marks the key invalid', async () => {
      const { result, guildConfigUpdates } = await runAuth403Job(2)
      expect(result.success).toBe(false)
      expect(guildConfigUpdates).toHaveLength(1)
      expect(guildConfigUpdates[0]).toEqual({
        api_key_is_valid: false,
        consecutive_sync_failures: 3
      })
    })

    it('missing strike row counts as strike 1, not an invalidation', async () => {
      const { TacticusApiError } = await import('@/app/lib/sync/worker-types')
      mockFetchTacticusApi.mockRejectedValue(
        new TacticusApiError(403, 'GUILD01')
      )
      const { from, calls } = buildRecordingFromMock({
        guild_config: { singleData: mockGuildConfig, maybeSingleData: null },
        sync_queue: {}
      })
      const supabase = {
        rpc: vi.fn(buildRpcMock().impl),
        from,
        functions: {
          invoke: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      } as any
      await processJob(
        { id: 'j-403m', guild_code: 'GUILD01', job_type: 'player_sync' },
        supabase,
        'w-1'
      )
      const updates = calls
        .filter((c) => c.table === 'guild_config' && c.operation === 'update')
        .map((c) => c.args[0] as Record<string, unknown>)
      expect(updates).toEqual([{ consecutive_sync_failures: 1 }])
    })

    it('404 still invalidates immediately — throttling never presents as 404', async () => {
      const { TacticusApiError } = await import('@/app/lib/sync/worker-types')
      mockFetchTacticusApi.mockRejectedValue(
        new TacticusApiError(404, 'GUILD01')
      )
      const { from, calls } = buildRecordingFromMock({
        guild_config: { singleData: mockGuildConfig },
        sync_queue: {}
      })
      const supabase = {
        rpc: vi.fn(buildRpcMock().impl),
        from,
        functions: {
          invoke: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      } as any
      await processJob(
        { id: 'j-404', guild_code: 'GUILD01', job_type: 'player_sync' },
        supabase,
        'w-1'
      )
      const updates = calls
        .filter((c) => c.table === 'guild_config' && c.operation === 'update')
        .map((c) => c.args[0] as Record<string, unknown>)
      expect(updates).toEqual([{ api_key_is_valid: false }])
    })
  })
})

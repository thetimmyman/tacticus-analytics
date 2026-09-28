import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Identity resolves before raid rows are written, or a renamed player's battle lands under the old name. */

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

const fetchTacticusApi = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/sync/tacticus-api-client', () => ({ fetchTacticusApi }))

const loadExistingPlayerMappings = vi.hoisted(() => vi.fn())
const fetchBossMappings = vi.hoisted(() => vi.fn())
const updateBombTracking = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/sync/db-operations', () => ({
  loadExistingPlayerMappings,
  fetchBossMappings,
  updateBombTracking
}))

const runPostSyncHooks = vi.hoisted(() => vi.fn())
const refreshGuildRoster = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/sync/post-sync-hooks', () => ({
  runPostSyncHooks,
  refreshGuildRoster,
  checkSeasonCoverage: vi.fn().mockResolvedValue(undefined)
}))

const runHeraldFromDb = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    detected: 0,
    posted: 0,
    deduped: 0,
    failed: 0,
    availability_detected: 0,
    availability_posted: 0,
    availability_deduped: 0,
    availability_failed: 0
  })
)
vi.mock('@/app/lib/herald/from-db', () => ({ runHeraldFromDb }))

vi.mock('@/app/lib/sync/execution-locks', () => ({
  getPipelineAExecutionLockConfig: () => ({ enabled: false }),
  acquirePipelineAExecutionLock: vi.fn(),
  releasePipelineAExecutionLock: vi.fn()
}))

import {
  runRaidSyncWithOptionalExecutionLock,
  runQuietTickMaintenance,
  QUIET_ROSTER_REFRESH_MS,
  QUIET_HERALD_RETRY_MS
} from '@/app/lib/sync/worker-jobs/raid-sync'
import type {
  ServiceSupabaseClient,
  WorkerResult
} from '@/app/lib/sync/worker-types'
import { WORKER_CONFIG } from '@/app/lib/sync/worker-types'

type Row = Record<string, unknown>

type Recorder = {
  ops: string[]
  battleRows: Row[]
  mappingWrites: Row[]
  upsertOptions?: Record<string, unknown>[]
  alreadyStored?: number
  storedKeyRows?: Row[]
  storedKeyError?: boolean
}

// Any other table throws so drift cannot produce a false green.
function makeSupabase(
  recorder: Recorder,
  fixtures: { existingMappingRows?: Row[] } = {}
) {
  const fromHandler = (table: string) => {
    if (table === 'player_mapping') {
      return {
        select: (_columns: string) => {
          let byPlayerId = false
          const builder = {
            in: (_column: string, _values: readonly unknown[]) => {
              byPlayerId = true
              return builder
            },
            eq: (_column: string, _value: unknown) => builder,
            like: (_column: string, _pattern: string) => builder,
            then: (
              resolve: (value: { data: Row[]; error: null }) => unknown
            ) => {
              recorder.ops.push('player_mapping.select')
              return Promise.resolve({
                data: byPlayerId ? (fixtures.existingMappingRows ?? []) : [],
                error: null
              }).then(resolve)
            }
          }
          return builder
        },
        upsert: (rows: Row | Row[]) => {
          recorder.ops.push('player_mapping.write')
          recorder.mappingWrites.push(...(Array.isArray(rows) ? rows : [rows]))
          return Promise.resolve({ data: null, error: null })
        },
        update: (payload: Row) => ({
          eq: (_column: string, _playerId: unknown) => {
            recorder.ops.push('player_mapping.write')
            recorder.mappingWrites.push(payload)
            return Promise.resolve({ data: null, error: null })
          }
        })
      }
    }
    if (table === 'EOT_GR_data') {
      return {
        select: (_columns: string) => {
          const builder = {
            eq: (_column: string, _value: unknown) => builder,
            in: (_column: string, _values: readonly unknown[]) => builder,
            like: (_column: string, _pattern: string) => builder,
            gte: (_column: string, _value: string) => builder,
            gt: (_column: string, _value: number) => builder,
            order: (_column: string, _opts?: unknown) => builder,
            limit: (_count: number) => {
              recorder.ops.push('EOT_GR_data.stored_keys')
              return Promise.resolve(
                recorder.storedKeyError
                  ? { data: null, error: { message: 'boom' } }
                  : {
                      data: recorder.storedKeyRows ?? [],
                      error: null
                    }
              )
            },
            then: (
              resolve: (value: { data: Row[]; error: null }) => unknown
            ) => {
              recorder.ops.push('EOT_GR_data.tombstone_read')
              return Promise.resolve({ data: [], error: null }).then(resolve)
            }
          }
          return builder
        },
        upsert: (rows: Row[], options?: Record<string, unknown>) => ({
          select: (_columns: string) => {
            recorder.ops.push('EOT_GR_data.upsert')
            recorder.battleRows.push(...rows)
            ;(recorder.upsertOptions ??= []).push(options ?? {})
            const returned = options?.ignoreDuplicates
              ? rows.slice(recorder.alreadyStored ?? 0)
              : rows
            return Promise.resolve({
              data: returned.map((_row, index) => ({ id: index + 1 })),
              error: null
            })
          }
        })
      }
    }
    if (table === 'guild_config') {
      return {
        update: (payload: Row) => ({
          eq: (_column: string, _value: unknown) => {
            recorder.ops.push(
              `guild_config.update:${Object.keys(payload).join(',')}`
            )
            return Promise.resolve({ data: null, error: null })
          }
        })
      }
    }
    throw new Error(`Unexpected .from('${table}') in raid-sync ordering test`)
  }
  return { from: fromHandler } as unknown as ServiceSupabaseClient
}

function makeResult(): WorkerResult {
  return {
    jobId: 'job-1',
    success: true,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  } as WorkerResult
}

const JOB = {
  id: 'job-1',
  guild_code: 'GUILD',
  job_type: 'incremental_sync'
} as never

const CONFIG = {
  guild_code: 'GUILD',
  cluster_code: null,
  cluster_id: null
} as never

const OPTIONS = {
  deleteBeforeUpsert: false,
  strictEntryFilter: false,
  batchedUpsert: false,
  runCoverageCheck: false
}

describe('runRaidSync — identity is resolved before the raid rows are written (PS-659)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchBossMappings.mockResolvedValue({})
    updateBombTracking.mockResolvedValue(undefined)
    runPostSyncHooks.mockResolvedValue(undefined)
    fetchTacticusApi.mockResolvedValue({
      json: async () => ({
        season: 100,
        entries: [
          {
            userId: 'user-1',
            username: 'NewRealName',
            type: 'Szarekh',
            encounterIndex: 0,
            damageDealt: 1000,
            startedOn: '2026-09-16T00:00:00.000Z',
            completedOn: '2026-09-16T00:01:00.000Z'
          }
        ]
      })
    })
  })

  it('writes the battle under the name this same run resolves, not the stale mapping', async () => {
    loadExistingPlayerMappings.mockResolvedValue(
      new Map([
        ['user-1', 'StaleOldName'],
        ['user-1'.toLowerCase(), 'StaleOldName']
      ])
    )
    const recorder: Recorder = { ops: [], battleRows: [], mappingWrites: [] }
    const supabase = makeSupabase(recorder, {
      existingMappingRows: [
        {
          player_id: 'user-1',
          display_name: 'StaleOldName',
          original_display_name: null,
          has_duplicate_name: false
        }
      ]
    })

    await runRaidSyncWithOptionalExecutionLock(
      JOB,
      CONFIG,
      'api-key',
      supabase,
      makeResult(),
      'worker-1',
      OPTIONS
    )

    const mappingWriteAt = recorder.ops.indexOf('player_mapping.write')
    const battleUpsertAt = recorder.ops.indexOf('EOT_GR_data.upsert')
    expect(mappingWriteAt).toBeGreaterThanOrEqual(0)
    expect(battleUpsertAt).toBeGreaterThanOrEqual(0)
    expect(mappingWriteAt).toBeLessThan(battleUpsertAt)

    expect(recorder.mappingWrites[0]).toMatchObject({
      display_name: 'NewRealName'
    })
    expect(recorder.battleRows).toHaveLength(1)
    expect(recorder.battleRows[0]?.displayName).toBe('NewRealName')
    expect(recorder.battleRows[0]).not.toHaveProperty('timestamp')
  })

  it('keeps an erased subject tombstoned when the same entries are re-ingested', async () => {
    // Re-ingesting an erased subject must keep the Article 17 tombstone despite upstream's real name.
    loadExistingPlayerMappings.mockResolvedValue(new Map())
    const recorder: Recorder = { ops: [], battleRows: [], mappingWrites: [] }
    const supabase = makeSupabase(recorder, {
      existingMappingRows: [
        {
          player_id: 'user-1',
          display_name: '[DELETED_USER_9f8e7d6c]',
          original_display_name: null,
          has_duplicate_name: false
        }
      ]
    })

    await runRaidSyncWithOptionalExecutionLock(
      JOB,
      CONFIG,
      'api-key',
      supabase,
      makeResult(),
      'worker-1',
      OPTIONS
    )

    expect(recorder.mappingWrites).toHaveLength(0)
    expect(recorder.battleRows).toHaveLength(1)
    expect(recorder.battleRows[0]?.displayName).toBe('[DELETED_USER_9f8e7d6c]')
  })

  it('withholds the success watermark when sanitization drops only part of the feed', async () => {
    fetchTacticusApi.mockResolvedValue({
      json: async () => ({
        season: 100,
        entries: [
          {
            userId: 'user-1',
            username: 'ValidPlayer',
            type: 'Szarekh',
            encounterIndex: 0,
            damageDealt: 1000,
            startedOn: '2026-09-16T00:00:00.000Z',
            completedOn: '2026-09-16T00:01:00.000Z'
          },
          {
            userId: '',
            username: 'BrokenPlayer',
            encounterIndex: 0,
            startedOn: '2026-09-16T00:00:00.000Z'
          }
        ]
      })
    })
    loadExistingPlayerMappings.mockResolvedValue(new Map())
    const recorder: Recorder = { ops: [], battleRows: [], mappingWrites: [] }
    const result = makeResult()

    await expect(
      runRaidSyncWithOptionalExecutionLock(
        JOB,
        CONFIG,
        'api-key',
        makeSupabase(recorder),
        result,
        'worker-1',
        OPTIONS
      )
    ).rejects.toThrow('Raid ingest incomplete')

    expect(recorder.battleRows).toHaveLength(1)
    expect(result.errors).toContain('Sanitization dropped 1 invalid entries')
    expect(result.raidDataLanded).toBe(false)
  })

  it('does not treat a missing entries array as a quiet healthy guild', async () => {
    fetchTacticusApi.mockResolvedValue({ json: async () => ({ season: 100 }) })
    const result = makeResult()

    await expect(
      runRaidSyncWithOptionalExecutionLock(
        JOB,
        CONFIG,
        'api-key',
        makeSupabase({ ops: [], battleRows: [], mappingWrites: [] }),
        result,
        'worker-1',
        OPTIONS
      )
    ).rejects.toThrow('Raid API response did not contain an entries array')

    expect(result.errors).toContain(
      'Raid API response did not contain an entries array'
    )
    expect(result.raidDataLanded).toBeUndefined()
  })

  it('does not treat an empty payload without a season as a healthy quiet feed', async () => {
    fetchTacticusApi.mockResolvedValue({ json: async () => ({ entries: [] }) })
    const result = makeResult()

    await expect(
      runRaidSyncWithOptionalExecutionLock(
        JOB,
        CONFIG,
        'api-key',
        makeSupabase({ ops: [], battleRows: [], mappingWrites: [] }),
        result,
        'worker-1',
        OPTIONS
      )
    ).rejects.toThrow('API response missing season number')
    expect(result.raidDataLanded).toBeUndefined()
  })

  it('records a healthy empty ingest for nested season metadata', async () => {
    fetchTacticusApi.mockResolvedValue({
      json: async () => ({ body: { season: 110, entries: [] } })
    })
    const result = makeResult()
    const recorder: Recorder = { ops: [], battleRows: [], mappingWrites: [] }
    await runRaidSyncWithOptionalExecutionLock(
      JOB,
      CONFIG,
      'api-key',
      makeSupabase(recorder),
      result,
      'worker-1',
      OPTIONS
    )
    expect(result.raidDataLanded).toBe(true)
    expect(recorder.battleRows).toHaveLength(0)
  })

  it('writes valid battles beside a null entry but fails the incomplete snapshot', async () => {
    fetchTacticusApi.mockResolvedValue({
      json: async () => ({
        season: 110,
        entries: [
          null,
          {
            userId: 'user-1',
            username: 'ValidPlayer',
            type: 'Szarekh',
            encounterIndex: 0,
            damageDealt: 1000,
            startedOn: '2026-09-16T00:00:00.000Z',
            completedOn: '2026-09-16T00:01:00.000Z'
          }
        ]
      })
    })
    loadExistingPlayerMappings.mockResolvedValue(new Map())
    const result = makeResult()
    const recorder: Recorder = { ops: [], battleRows: [], mappingWrites: [] }
    await expect(
      runRaidSyncWithOptionalExecutionLock(
        JOB,
        CONFIG,
        'api-key',
        makeSupabase(recorder),
        result,
        'worker-1',
        OPTIONS
      )
    ).rejects.toThrow('Raid ingest incomplete')
    expect(recorder.battleRows).toHaveLength(1)
    expect(result.raidDataLanded).toBe(false)
    expect(result.errors).toContain(
      'Raid sync skipped 1 entries with invalid timestamps'
    )
  })

  it('imports late-published battles even when their event time predates the incremental watermark', async () => {
    fetchTacticusApi.mockResolvedValue({
      json: async () => ({
        season: 100,
        entries: [
          {
            userId: 'user-1',
            username: 'LatePublishedPlayer',
            type: 'Szarekh',
            encounterIndex: 0,
            damageDealt: 1000,
            startedOn: '2020-01-01T00:00:00.000Z'
          }
        ]
      })
    })
    loadExistingPlayerMappings.mockResolvedValue(new Map())
    const recorder: Recorder = { ops: [], battleRows: [], mappingWrites: [] }
    const result = makeResult()

    await runRaidSyncWithOptionalExecutionLock(
      { ...JOB, job_type: 'incremental_sync' } as never,
      CONFIG,
      'api-key',
      makeSupabase(recorder),
      result,
      'worker-1',
      OPTIONS
    )

    expect(recorder.battleRows).toHaveLength(1)
    expect(recorder.battleRows[0]?.displayName).toBe('LatePublishedPlayer')
    expect(result.raidDataLanded).toBe(true)
  })

  it('rejects a full-snapshot entry with no parseable timestamp without stamping success', async () => {
    fetchTacticusApi.mockResolvedValue({
      json: async () => ({
        season: 100,
        entries: [
          {
            userId: 'user-1',
            username: 'UnknownTime',
            type: 'Szarekh',
            encounterIndex: 0,
            startedOn: 'not-a-time',
            completedOn: null,
            timestamp: undefined
          }
        ]
      })
    })
    const result = makeResult()

    await expect(
      runRaidSyncWithOptionalExecutionLock(
        JOB,
        CONFIG,
        'api-key',
        makeSupabase({ ops: [], battleRows: [], mappingWrites: [] }),
        result,
        'worker-1',
        OPTIONS
      )
    ).rejects.toThrow('Raid sync could not validate every source entry')
    expect(result.errors).toContain(
      'Raid sync skipped 1 entries with invalid timestamps'
    )
    expect(result.raidDataLanded).toBe(false)
  })

  it('batches a full snapshot larger than the write limit on incremental syncs', async () => {
    const entries = Array.from(
      { length: WORKER_CONFIG.batchSize + 1 },
      (_, index) => ({
        userId: `user-${index}`,
        username: `Player ${index}`,
        type: 'Szarekh',
        encounterIndex: 0,
        damageDealt: 1000,
        startedOn: '2026-09-16T00:00:00.000Z',
        completedOn: '2026-09-16T00:01:00.000Z'
      })
    )
    fetchTacticusApi.mockResolvedValue({
      json: async () => ({ season: 100, entries })
    })
    loadExistingPlayerMappings.mockResolvedValue(new Map())
    const recorder: Recorder = { ops: [], battleRows: [], mappingWrites: [] }
    const result = makeResult()

    await runRaidSyncWithOptionalExecutionLock(
      { ...JOB, job_type: 'incremental_sync' } as never,
      CONFIG,
      'api-key',
      makeSupabase(recorder),
      result,
      'worker-1',
      OPTIONS
    )

    expect(recorder.battleRows).toHaveLength(WORKER_CONFIG.batchSize + 1)
    expect(recorder.battleRows.every((row) => !('timestamp' in row))).toBe(true)
    expect(
      recorder.ops.filter((op) => op === 'EOT_GR_data.upsert')
    ).toHaveLength(2)
    expect(result.raidDataLanded).toBe(true)
  })

  describe('insert-or-ignore replay (no time filter)', () => {
    const snapshot = (n: number) =>
      Array.from({ length: n }, (_, index) => ({
        userId: `user-${index}`,
        username: `Player ${index}`,
        type: 'Szarekh',
        encounterIndex: 0,
        damageDealt: 1000 + index,
        startedOn: '2026-09-16T00:00:00.000Z',
        completedOn: '2026-09-16T00:01:00.000Z'
      }))

    it('realtime/incremental syncs ignore already-stored battles instead of rewriting them, and still land', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({ season: 100, entries: snapshot(5) })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        alreadyStored: 4
      }
      const result = makeResult()

      await runRaidSyncWithOptionalExecutionLock(
        {
          id: 'job-1',
          guild_code: 'GUILD',
          job_type: 'realtime_sync'
        } as never,
        CONFIG,
        'api-key',
        makeSupabase(recorder),
        result,
        'worker-1',
        OPTIONS
      )

      // The whole snapshot is sent (no watermark filter) as insert-or-ignore.
      expect(recorder.battleRows).toHaveLength(5)
      expect(recorder.upsertOptions?.[0]).toMatchObject({
        ignoreDuplicates: true
      })
      expect(result.upsertFailures).toBe(0)
      expect(result.recordsProcessed).toBe(1)
      expect(result.raidDataLanded).toBe(true)
    })

    it('a replay where every battle is already stored is a healthy no-op, not a failure', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({ season: 100, entries: snapshot(3) })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        alreadyStored: 3
      }
      const result = makeResult()

      await runRaidSyncWithOptionalExecutionLock(
        {
          id: 'job-1',
          guild_code: 'GUILD',
          job_type: 'incremental_sync'
        } as never,
        CONFIG,
        'api-key',
        makeSupabase(recorder),
        result,
        'worker-1',
        OPTIONS
      )

      expect(result.recordsProcessed).toBe(0)
      expect(result.upsertFailures).toBe(0)
      expect(result.raidDataLanded).toBe(true)
    })

    it('full sync still rewrites every row (reconcile needs every id) and fails on a short acknowledgement', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({ season: 100, entries: snapshot(3) })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = { ops: [], battleRows: [], mappingWrites: [] }

      await runRaidSyncWithOptionalExecutionLock(
        { id: 'job-1', guild_code: 'GUILD', job_type: 'full_sync' } as never,
        CONFIG,
        'api-key',
        makeSupabase(recorder),
        makeResult(),
        'worker-1',
        { ...OPTIONS, deleteBeforeUpsert: true, batchedUpsert: true }
      ).catch(() => undefined)

      expect(recorder.upsertOptions?.[0]).toMatchObject({
        ignoreDuplicates: false
      })
    })
  })

  describe('only battles not already stored enter the per-entry pipeline', () => {
    const battle = (i: number) => ({
      userId: `user-${i}`,
      username: `Player ${i}`,
      type: 'Szarekh',
      encounterIndex: 0,
      damageDealt: 1000 + i,
      startedOn: '2026-09-16T00:00:00.000Z',
      completedOn: '2026-09-16T00:01:00.000Z'
    })
    const storedRow = (i: number) => ({
      Guild: 'GUILD',
      Season: '100',
      userId: `user-${i}`,
      encounterId: 0,
      startedOn: '2026-09-16T00:00:00+00:00',
      completedOn: '2026-09-16T00:01:00+00:00',
      damageDealt: 1000 + i,
      damageType: 'Battle'
    })
    const run = (recorder: Recorder, jobType: string, options = OPTIONS) => {
      const result = makeResult()
      return runRaidSyncWithOptionalExecutionLock(
        { id: 'job-1', guild_code: 'GUILD', job_type: jobType } as never,
        CONFIG,
        'api-key',
        makeSupabase(recorder),
        result,
        'worker-1',
        options
      ).then(() => result)
    }

    it('processes and writes only the battle that is not stored yet', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({
          season: 100,
          entries: [battle(0), battle(1), battle(2)]
        })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        storedKeyRows: [storedRow(0), storedRow(1)]
      }
      const result = await run(recorder, 'realtime_sync')

      expect(recorder.ops).toContain('EOT_GR_data.stored_keys')
      expect(recorder.battleRows.map((r) => r.userId)).toEqual(['user-2'])
      expect(result.raidDataLanded).toBe(true)
      expect(recorder.ops).toContain('guild_config.update:last_raid_write_at')
    })

    it('treats a fully stored snapshot as a healthy no-op with no writes', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({ season: 100, entries: [battle(0), battle(1)] })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        storedKeyRows: [storedRow(0), storedRow(1)]
      }
      const result = await run(recorder, 'incremental_sync')

      expect(recorder.battleRows).toHaveLength(0)
      expect(recorder.ops).not.toContain('EOT_GR_data.upsert')
      expect(result.raidDataLanded).toBe(true)
    })

    it('falls back to the whole snapshot when stored keys cannot be read', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({ season: 100, entries: [battle(0), battle(1)] })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        storedKeyError: true
      }
      await run(recorder, 'realtime_sync')

      expect(recorder.battleRows).toHaveLength(2)
    })

    it('a fully stored snapshot still fails when sanitization dropped part of the feed', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({
          season: 100,
          entries: [battle(0), { userId: '', username: 'Broken' }]
        })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        storedKeyRows: [storedRow(0)]
      }
      const result = makeResult()
      await expect(
        runRaidSyncWithOptionalExecutionLock(
          JOB,
          CONFIG,
          'api-key',
          makeSupabase(recorder),
          result,
          'worker-1',
          OPTIONS
        )
      ).rejects.toThrow('Raid ingest incomplete')
      expect(result.raidDataLanded).toBe(false)
    })

    it('a fully stored snapshot returns early: no identity writes, bomb tracking or hooks', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({ season: 100, entries: [battle(0), battle(1)] })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        storedKeyRows: [storedRow(0), storedRow(1)]
      }
      await run(recorder, 'realtime_sync')

      expect(recorder.ops).not.toContain('EOT_GR_data.upsert')
      expect(recorder.ops).not.toContain('player_mapping.write')
      expect(runPostSyncHooks).not.toHaveBeenCalled()
      expect(updateBombTracking).not.toHaveBeenCalled()
    })

    it('bomb tracking and identity resolution see the whole snapshot, not only unstored battles', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({
          season: 100,
          entries: [{ ...battle(0), username: 'RenamedPlayer' }, battle(1)]
        })
      })
      loadExistingPlayerMappings.mockResolvedValue(
        new Map([['user-0', 'OldName']])
      )
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        storedKeyRows: [storedRow(0)]
      }
      const supabase = makeSupabase(recorder, {
        existingMappingRows: [
          {
            player_id: 'user-0',
            display_name: 'OldName',
            original_display_name: null,
            has_duplicate_name: false
          }
        ]
      })
      await runRaidSyncWithOptionalExecutionLock(
        {
          id: 'job-1',
          guild_code: 'GUILD',
          job_type: 'realtime_sync'
        } as never,
        CONFIG,
        'api-key',
        supabase,
        makeResult(),
        'worker-1',
        OPTIONS
      )

      expect(recorder.battleRows.map((r) => r.userId)).toEqual(['user-1'])
      // The stored battle's newer username still refreshes the mapping,
      expect(recorder.mappingWrites).toContainEqual(
        expect.objectContaining({ display_name: 'RenamedPlayer' })
      )
      // and bomb tracking derives recency from the full snapshot.
      expect(updateBombTracking.mock.calls[0]?.[1]).toHaveLength(2)
    })

    it('a stored NULL damageDealt does not match a new zero-damage battle', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({
          season: 100,
          entries: [{ ...battle(0), damageDealt: 0 }]
        })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        storedKeyRows: [{ ...storedRow(0), damageDealt: null }]
      }
      await run(recorder, 'realtime_sync')

      expect(recorder.battleRows).toHaveLength(1)
    })

    it('full sync never filters: every battle is rewritten for reconcile', async () => {
      fetchTacticusApi.mockResolvedValue({
        json: async () => ({ season: 100, entries: [battle(0), battle(1)] })
      })
      loadExistingPlayerMappings.mockResolvedValue(new Map())
      const recorder: Recorder = {
        ops: [],
        battleRows: [],
        mappingWrites: [],
        storedKeyRows: [storedRow(0), storedRow(1)]
      }
      await run(recorder, 'full_sync', {
        ...OPTIONS,
        deleteBeforeUpsert: true,
        batchedUpsert: true
      }).catch(() => undefined)

      expect(recorder.ops).not.toContain('EOT_GR_data.stored_keys')
      expect(recorder.battleRows).toHaveLength(2)
    })
  })
})

describe('quiet-tick maintenance (PR #320 review)', () => {
  const NOW = Date.parse('2026-09-25T12:00:00Z')
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
  const supabase = {} as ServiceSupabaseClient
  const cfg = (extra: Record<string, unknown>) =>
    ({ guild_code: 'GUILD', ...extra }) as never

  beforeEach(() => {
    refreshGuildRoster.mockReset().mockResolvedValue(null)
    runHeraldFromDb.mockClear()
  })

  it('refreshes the roster when it has never been refreshed', async () => {
    await runQuietTickMaintenance(
      'GUILD',
      cfg({ last_roster_refresh_at: null, last_raid_write_at: null }),
      supabase,
      NOW
    )
    expect(refreshGuildRoster).toHaveBeenCalledTimes(1)
    expect(runHeraldFromDb).not.toHaveBeenCalled()
  })

  it('does not refresh within the hour, and does once it has passed', async () => {
    await runQuietTickMaintenance(
      'GUILD',
      cfg({ last_roster_refresh_at: iso(QUIET_ROSTER_REFRESH_MS - 60_000) }),
      supabase,
      NOW
    )
    expect(refreshGuildRoster).not.toHaveBeenCalled()

    await runQuietTickMaintenance(
      'GUILD',
      cfg({ last_roster_refresh_at: iso(QUIET_ROSTER_REFRESH_MS) }),
      supabase,
      NOW
    )
    expect(refreshGuildRoster).toHaveBeenCalledTimes(1)
  })

  it('retries Herald only while the last write is recent', async () => {
    await runQuietTickMaintenance(
      'GUILD',
      cfg({
        last_roster_refresh_at: iso(0),
        last_raid_write_at: iso(QUIET_HERALD_RETRY_MS - 60_000)
      }),
      supabase,
      NOW
    )
    expect(runHeraldFromDb).toHaveBeenCalledTimes(1)

    await runQuietTickMaintenance(
      'GUILD',
      cfg({
        last_roster_refresh_at: iso(0),
        last_raid_write_at: iso(QUIET_HERALD_RETRY_MS + 60_000)
      }),
      supabase,
      NOW
    )
    expect(runHeraldFromDb).toHaveBeenCalledTimes(1)
  })

  it('is a no-op before the marker migration is applied', async () => {
    await runQuietTickMaintenance('GUILD', cfg({}), supabase, NOW)
    expect(refreshGuildRoster).not.toHaveBeenCalled()
    expect(runHeraldFromDb).not.toHaveBeenCalled()
  })

  it('a failing roster refresh does not fail the tick', async () => {
    refreshGuildRoster.mockRejectedValueOnce(new Error('loki down'))
    await expect(
      runQuietTickMaintenance(
        'GUILD',
        cfg({ last_roster_refresh_at: null }),
        supabase,
        NOW
      )
    ).resolves.toBeUndefined()
  })
})

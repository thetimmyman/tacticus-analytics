import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ServiceSupabaseClient,
  WorkerResult
} from '@/app/lib/sync/worker-types'

const fetchTacticusApi = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/sync/tacticus-api-client', () => ({ fetchTacticusApi }))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))
vi.mock('@/app/lib/sync/execution-locks', () => ({
  getPipelineAExecutionLockConfig: () => ({ enabled: false })
}))
vi.mock('@/app/lib/sync/db-operations', () => ({
  loadExistingPlayerMappings: vi.fn().mockResolvedValue(new Map()),
  fetchBossMappings: vi.fn().mockResolvedValue({}),
  updateBombTracking: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/app/lib/sync/post-sync-hooks', () => ({
  runPostSyncHooks: vi.fn().mockResolvedValue(undefined),
  refreshGuildRoster: vi.fn().mockResolvedValue(undefined),
  checkSeasonCoverage: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/app/lib/herald/from-db', () => ({
  runHeraldFromDb: vi.fn().mockResolvedValue({
    detected: 0,
    posted: 0,
    deduped: 0,
    failed: 0,
    availability_detected: 0,
    availability_posted: 0,
    availability_deduped: 0,
    availability_failed: 0
  })
}))
vi.mock('@/app/lib/data/guild-roster', () => ({
  guildRosterQuery: vi.fn().mockResolvedValue({ data: [], error: null })
}))
vi.mock('@/app/lib/sync/transformers', () => ({
  extractEntries: (data: { entries: unknown[] }) => data.entries,
  sanitizeRaidEntries: (entries: unknown[]) => ({
    sanitized: entries,
    dropped: 0
  }),
  processRaidEntry: (
    entry: Record<string, unknown>,
    guild: string,
    season: string
  ) => ({
    ...entry,
    Guild: guild,
    Season: season,
    encounterId: 1,
    damageType: 'physical'
  }),
  filterProcessedData: (rows: unknown[]) => rows.filter(Boolean),
  handleDuplicateDisplayNames: (members: unknown[]) => members
}))

import { runRaidSyncWithOptionalExecutionLock } from '@/app/lib/sync/worker-jobs/raid-sync'
import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import {
  loadExistingPlayerMappings,
  fetchBossMappings,
  updateBombTracking
} from '@/app/lib/sync/db-operations'
import { runPostSyncHooks } from '@/app/lib/sync/post-sync-hooks'
import { runHeraldFromDb } from '@/app/lib/herald/from-db'

type Row = Record<string, unknown>
const START = '2026-01-01T00:00:00.000Z'
const OLD = '2026-01-01T00:01:00.000Z'
const NEW = '2026-01-01T02:01:00.000Z'
const entry = (completedOn?: string, userId = 'TestPlayerA') => ({
  userId,
  username: 'TestPlayerA',
  startedOn: START,
  completedOn,
  damageDealt: 100
})
const storedRow = (value: Row, id: number) => ({
  ...value,
  id,
  Guild: 'TESTGUILD',
  Season: '1',
  encounterId: 1,
  damageType: 'physical'
})

function createDb(pages: Row[][]) {
  const calls = {
    gte: [] as Array<[string, string]>,
    gt: [] as Array<[string, number]>,
    writes: [] as Row[]
  }
  const from = (table: string) => {
    if (table === 'EOT_GR_data')
      return {
        select: () => {
          let keyRead = false
          let after: number | null = null
          const query = {
            eq: () => query,
            like: () => query,
            in: () => query,
            gte: (column: string, value: string) => {
              calls.gte.push([column, value])
              return query
            },
            gt: (column: string, value: number) => {
              calls.gt.push([column, value])
              after = value
              return query
            },
            order: () => query,
            limit: () => {
              keyRead = true
              return Promise.resolve({
                data: pages[after === null ? 0 : 1] ?? [],
                error: null
              })
            },
            then: (resolve: (value: unknown) => unknown) => {
              if (keyRead) throw new Error('Unexpected key read continuation')
              return Promise.resolve({ data: [], error: null }).then(resolve)
            }
          }
          return query
        },
        upsert: (rows: Row[]) => ({
          select: () => {
            calls.writes.push(...rows)
            return Promise.resolve({
              data: rows.map((_, i) => ({ id: i + 1 })),
              error: null
            })
          }
        })
      }
    if (table === 'player_mapping')
      return {
        select: () => {
          const query = {
            like: () => query,
            in: () => Promise.resolve({ data: [], error: null })
          }
          return query
        },
        upsert: () => Promise.resolve({ error: null })
      }
    if (table === 'guild_config')
      return {
        update: () => ({ eq: () => Promise.resolve({ error: null }) })
      }
    throw new Error(`Unexpected table: ${table}`)
  }
  return { db: { from } as unknown as ServiceSupabaseClient, calls }
}

async function run(entries: Row[], pages: Row[][]) {
  const { db, calls } = createDb(pages)
  fetchTacticusApi.mockResolvedValue({
    json: async () => ({ season: 1, entries })
  })
  const result = {
    jobId: 'job-test',
    success: true,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  } as WorkerResult
  await runRaidSyncWithOptionalExecutionLock(
    {
      id: 'job-test',
      guild_code: 'TESTGUILD',
      job_type: 'incremental_sync'
    } as never,
    { guild_code: 'TESTGUILD' } as never,
    'test-api-key',
    db,
    result,
    'test-worker',
    {
      deleteBeforeUpsert: false,
      strictEntryFilter: false,
      batchedUpsert: false,
      runCoverageCheck: false
    }
  )
  return { calls, result }
}

describe('raid sync stored keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(guildRosterQuery).mockResolvedValue({
      data: [],
      error: null
    } as never)
    vi.mocked(loadExistingPlayerMappings).mockResolvedValue(new Map())
    vi.mocked(fetchBossMappings).mockResolvedValue({})
    vi.mocked(updateBombTracking).mockResolvedValue(undefined)
    vi.mocked(runPostSyncHooks).mockResolvedValue(undefined)
    vi.mocked(runHeraldFromDb).mockResolvedValue({
      detected: 0,
      posted: 0,
      deduped: 0,
      failed: 0,
      availability_detected: 0,
      availability_posted: 0,
      availability_deduped: 0,
      availability_failed: 0
    } as never)
  })

  it('bounds reads by the earliest completed battle minus one hour', async () => {
    const { calls } = await run([entry(NEW), entry(OLD, 'TestPlayerB')], [])
    expect(calls.gte).toEqual([['completedOn', '2025-12-31T23:01:00.000Z']])
  })

  it('reads without a bound when any completed time is missing', async () => {
    const { calls } = await run(
      [entry(NEW), entry(undefined, 'TestPlayerB')],
      []
    )
    expect(calls.gte).toEqual([])
  })

  it('requests the second page by id and honors its stored key', async () => {
    const target = entry(NEW)
    const filler = Array.from({ length: 1000 }, (_, index) =>
      storedRow(entry(NEW, `TestPlayer${index + 100}`), index + 1)
    )
    const { calls, result } = await run(
      [target],
      [filler, [storedRow(target, 1001)]]
    )
    expect(calls.gt).toEqual([['id', 1000]])
    expect(calls.writes).toEqual([])
    expect(result.syncPath).toBe('quiet')
    expect(result.storedKeys).toBe(1001)
  })

  it('writes an older unstored battle and skips a fully stored snapshot', async () => {
    const older = entry(OLD)
    const newer = entry(NEW, 'TestPlayerB')
    const first = await run([older], [[storedRow(newer, 1)]])
    expect(first.calls.writes).toHaveLength(1)
    expect(first.calls.writes[0]?.completedOn).toBe(OLD)
    expect(first.result.syncPath).toBe('write')

    const second = await run([older], [[storedRow(older, 2)]])
    expect(second.calls.writes).toEqual([])
    expect(second.result.syncPath).toBe('quiet')
  })
})

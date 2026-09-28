import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ServiceSupabaseClient,
  WorkerResult
} from '@/app/lib/sync/worker-types'

const fetchTacticusApi = vi.hoisted(() => vi.fn())
const refreshGuildRoster = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/sync/tacticus-api-client', () => ({ fetchTacticusApi }))
vi.mock('@/app/lib/sync/post-sync-hooks', () => ({
  refreshGuildRoster,
  runPostSyncHooks: vi.fn(),
  checkSeasonCoverage: vi.fn()
}))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))
vi.mock('@/app/lib/herald/from-db', () => ({ runHeraldFromDb: vi.fn() }))
vi.mock('@/app/lib/sync/execution-locks', () => ({
  getPipelineAExecutionLockConfig: () => ({ enabled: false })
}))

import { runRaidSyncWithOptionalExecutionLock } from '@/app/lib/sync/worker-jobs/raid-sync'

async function run(lastRosterRefreshAt: string | null) {
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
    {
      guild_code: 'TESTGUILD',
      last_roster_refresh_at: lastRosterRefreshAt
    } as never,
    'test-api-key',
    {} as ServiceSupabaseClient,
    result,
    'test-worker',
    {
      deleteBeforeUpsert: false,
      strictEntryFilter: false,
      batchedUpsert: false,
      runCoverageCheck: false
    }
  )
  return result
}

describe('raid sync empty feed maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchTacticusApi.mockResolvedValue({
      json: async () => ({ season: 1, entries: [] })
    })
    refreshGuildRoster.mockResolvedValue(undefined)
  })

  it.each([
    ['missing', null],
    ['older than an hour', new Date(Date.now() - 61 * 60_000).toISOString()]
  ])('refreshes the roster when the stamp is %s', async (_label, stamp) => {
    const result = await run(stamp)
    expect(refreshGuildRoster).toHaveBeenCalledOnce()
    expect(result.syncPath).toBe('empty')
    expect(result.phaseMs?.quiet_maintenance).toEqual(expect.any(Number))
  })

  it('does not refresh when the stamp is recent', async () => {
    const result = await run(new Date(Date.now() - 10 * 60_000).toISOString())
    expect(refreshGuildRoster).not.toHaveBeenCalled()
    expect(result.syncPath).toBe('empty')
  })
})

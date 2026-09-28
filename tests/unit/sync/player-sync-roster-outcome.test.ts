import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetchTacticusApi = vi.fn()
vi.mock('@/app/lib/sync/tacticus-api-client', () => ({
  fetchTacticusApi: (...args: readonly unknown[]) =>
    mockFetchTacticusApi(...args)
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

import { processPlayerSync } from '@/app/lib/sync/worker-jobs/player-sync'
import type {
  GuildApiMember,
  ServiceSupabaseClient,
  SyncJob,
  WorkerResult
} from '@/app/lib/sync/worker-types'
import type { GuildConfig } from '@tacticus/app-core/types'

type UpsertBehavior = 'ok' | 'throw' | { message: string }

interface RpcCall {
  fn: string
  args?: Record<string, unknown>
}

function buildSupabase(
  behaviors: Map<string, UpsertBehavior> = new Map(),
  rpcOverrides: Record<string, (args?: Record<string, unknown>) => unknown> = {}
) {
  const rpcCalls: RpcCall[] = []
  const rpcImpl = async (fn: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    const override = rpcOverrides[fn]
    if (override) return override(args)
    return { data: null, error: null }
  }
  const upsert = async (row: { player_id?: string }, _opts?: unknown) => {
    const behavior = behaviors.get(row.player_id ?? '')
    if (behavior === 'throw') {
      throw new Error('upsert exploded')
    }
    if (behavior && typeof behavior === 'object') {
      return { data: null, error: { message: behavior.message } }
    }
    return { data: [row], error: null }
  }
  const from = (table: string) => {
    if (table === 'player_mapping') {
      return { upsert }
    }
    return {
      update: () => ({
        eq: async () => ({ data: null, error: null })
      })
    }
  }
  const supabase = { from, rpc: rpcImpl } as unknown as ServiceSupabaseClient
  return { supabase, rpcCalls }
}

const job: SyncJob = {
  id: 'j1',
  guild_code: 'GUILD01',
  job_type: 'player_sync'
}

const config = { display_name: 'Test Guild' } as GuildConfig

function makeResult(): WorkerResult {
  return {
    jobId: 'j1',
    success: true,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  }
}

function member(userId: string, displayName?: string): GuildApiMember {
  return { userId, displayName }
}

describe('processPlayerSync roster write outcome', () => {
  beforeEach(() => {
    mockFetchTacticusApi.mockReset()
  })

  function stubApi(members: GuildApiMember[]) {
    mockFetchTacticusApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ members })
    })
  }

  it('records ok=true with the successful upsert count when every member succeeds', async () => {
    stubApi([
      member('player-a', 'TestPlayerA'),
      member('player-b', 'TestPlayerB')
    ])
    const { supabase, rpcCalls } = buildSupabase(new Map())
    const result = makeResult()

    await processPlayerSync(job, config, 'test-api-key', supabase, result)

    expect(result.playersUpdated).toBe(2)
    expect(result.upsertFailures).toBe(0)
    expect(result.errors).toEqual([])

    const outcome = rpcCalls.filter(
      (call) => call.fn === 'record_roster_write_outcome'
    )
    expect(outcome).toHaveLength(1)
    expect(outcome[0].args).toEqual({
      p_guild_code: 'GUILD01',
      p_ok: true,
      p_rows_written: 2,
      p_reason: null
    })
  })

  it('records ok=true with the successful count when one member fails', async () => {
    stubApi([
      member('player-a', 'TestPlayerA'),
      member('player-b', 'TestPlayerB'),
      member('player-c', 'TestPlayerC')
    ])
    const { supabase, rpcCalls } = buildSupabase(
      new Map([['player-c', { message: 'boom' }]])
    )
    const result = makeResult()

    await expect(
      processPlayerSync(job, config, 'test-api-key', supabase, result)
    ).resolves.toBeUndefined()

    expect(result.playersUpdated).toBe(2)
    expect(result.upsertFailures).toBe(1)
    expect(result.errors).toContain('Player upsert failed: boom')

    const outcome = rpcCalls.filter(
      (call) => call.fn === 'record_roster_write_outcome'
    )
    expect(outcome).toHaveLength(1)
    expect(outcome[0].args).toEqual({
      p_guild_code: 'GUILD01',
      p_ok: true,
      p_rows_written: 2,
      p_reason: null
    })
  })

  it('records ok=false and throws when every member fails', async () => {
    stubApi([member('player-a'), member('player-b')])
    const { supabase, rpcCalls } = buildSupabase(
      new Map([
        ['player-a', { message: 'err-a' }],
        ['player-b', 'throw']
      ])
    )
    const result = makeResult()

    await expect(
      processPlayerSync(job, config, 'test-api-key', supabase, result)
    ).rejects.toThrow(/Player upsert failed for all 2 member/)

    expect(result.playersUpdated).toBe(0)
    expect(result.upsertFailures).toBe(2)
    expect(result.errors).toContain('Player upsert failed: err-a')
    expect(result.errors).toContain('Player upsert failed: upsert exploded')

    const outcome = rpcCalls.filter(
      (call) => call.fn === 'record_roster_write_outcome'
    )
    expect(outcome).toHaveLength(1)
    expect(outcome[0].args).toMatchObject({
      p_guild_code: 'GUILD01',
      p_ok: false,
      p_rows_written: 0
    })
    expect(outcome[0].args?.p_reason).toContain('for all 2 member(s)')
  })

  it('skips the outcome write for an empty roster', async () => {
    stubApi([])
    const { supabase, rpcCalls } = buildSupabase(new Map())
    const result = makeResult()

    await processPlayerSync(job, config, 'test-api-key', supabase, result)

    expect(result.playersUpdated).toBe(0)
    expect(result.upsertFailures).toBe(0)
    expect(
      rpcCalls.filter((call) => call.fn === 'record_roster_write_outcome')
    ).toHaveLength(0)
  })

  it('skips the outcome write when no member has a userId', async () => {
    stubApi([
      { userId: '' } as GuildApiMember,
      { displayName: 'NoId' } as GuildApiMember
    ])
    const { supabase, rpcCalls } = buildSupabase(new Map())
    const result = makeResult()

    await processPlayerSync(job, config, 'test-api-key', supabase, result)

    expect(result.playersUpdated).toBe(0)
    expect(result.upsertFailures).toBe(0)
    expect(
      rpcCalls.filter((call) => call.fn === 'record_roster_write_outcome')
    ).toHaveLength(0)
  })

  it('still resolves when recording the outcome returns an rpc error', async () => {
    stubApi([member('player-a')])
    const { supabase, rpcCalls } = buildSupabase(new Map(), {
      record_roster_write_outcome: () => ({
        data: null,
        error: { message: 'rpc failed' }
      })
    })
    const result = makeResult()

    await expect(
      processPlayerSync(job, config, 'test-api-key', supabase, result)
    ).resolves.toBeUndefined()

    expect(result.playersUpdated).toBe(1)
    expect(result.upsertFailures).toBe(0)
    expect(
      rpcCalls.filter((call) => call.fn === 'record_roster_write_outcome')
    ).toHaveLength(1)
  })

  it('still resolves when recording the outcome throws', async () => {
    stubApi([member('player-a')])
    const { supabase } = buildSupabase(new Map(), {
      record_roster_write_outcome: () => {
        throw new Error('rpc exploded')
      }
    })
    const result = makeResult()

    await expect(
      processPlayerSync(job, config, 'test-api-key', supabase, result)
    ).resolves.toBeUndefined()

    expect(result.playersUpdated).toBe(1)
    expect(result.upsertFailures).toBe(0)
  })
})

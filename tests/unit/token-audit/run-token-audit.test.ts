/** Rows come from the pre-writeback snapshot; write-back is guarded by fetch time and never fails the run. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { writeBackMock } = vi.hoisted(() => ({ writeBackMock: vi.fn() }))

vi.mock('@/app/api/guild-tokens/token-service', () => ({
  writeBackPlayerTokenSnapshot: writeBackMock
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: vi.fn()
}))

vi.mock('@/app/lib/services/season-timing-service', () => ({
  getSeasonTiming: vi.fn()
}))

vi.mock('@/app/lib/api/tacticus-client', () => ({
  tacticusAPI: {
    getPlayerWithRetry: vi.fn()
  }
}))

vi.mock('@tacticus/app-core/api-key-helper', () => ({
  getPlayerApiKey: vi.fn()
}))

vi.mock('@/app/lib/token-audit/audit-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/token-audit/audit-core')>()
  return { ...actual, buildAuditRow: vi.fn(actual.buildAuditRow) }
})

type KeyHolderRow = {
  player_id: string
  display_name: string
  guild_code: string
  tacticus_api_key_encrypted: string | null
  last_sync_tokens: number | null
  last_sync_bombs: number | null
  next_token_seconds: number | null
  next_bomb_seconds: number | null
  api_key_is_valid: boolean | null
}

type AuditInsertRow = Record<string, string | number | boolean | null>

type Envelope = {
  data?: KeyHolderRow[] | AuditInsertRow[] | string | null
  error?: { message: string } | null
}

type MockChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  not: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  then: (
    resolve: (value: Envelope) => void,
    reject?: (reason: Error) => void
  ) => Promise<void>
}

function makeDb(opts: {
  keyHolders: KeyHolderRow[]
  rpcTokenState: Envelope
  auditSnapshotRows?: AuditInsertRow[]
}) {
  const insertedBatches: Array<AuditInsertRow[]> = []
  const from = vi.fn((table: string) => {
    let inserted = false
    const passthrough = vi.fn(() => chain)
    const chain: MockChain = {
      select: passthrough,
      eq: passthrough,
      in: passthrough,
      not: passthrough,
      order: passthrough,
      limit: passthrough,
      insert: vi.fn((rows: AuditInsertRow[]) => {
        inserted = true
        insertedBatches.push(rows)
        return chain
      }),
      then: (resolve, reject) => {
        let envelope: Envelope
        if (table === 'player_mapping') {
          envelope = { data: opts.keyHolders, error: null }
        } else if (table === 'token_audit_snapshots') {
          envelope = inserted
            ? { error: null }
            : { data: opts.auditSnapshotRows ?? [], error: null }
        } else {
          envelope = { data: [], error: null }
        }
        return Promise.resolve(envelope).then(resolve, reject)
      }
    }
    return chain
  })
  const rpc = vi.fn((fn: string) => {
    if (fn === 'get_latest_season') {
      return Promise.resolve({ data: '100', error: null })
    }
    if (fn === 'get_player_token_state') {
      return Promise.resolve(opts.rpcTokenState)
    }
    return Promise.resolve({ data: [], error: null })
  })
  return { db: { from, rpc }, insertedBatches, rpc }
}

const MEMBER = {
  player_id: 'p1',
  display_name: 'Player One',
  guild_code: 'TEST',
  tacticus_api_key_encrypted: 'enc',
  last_sync_tokens: 5,
  last_sync_bombs: 2,
  next_token_seconds: 3600,
  next_bomb_seconds: 7200,
  api_key_is_valid: true
}

const MEMBER_TWO = {
  ...MEMBER,
  player_id: 'p2',
  display_name: 'Player Two'
}

const LIVE_API_RESPONSE = {
  progress: {
    guildRaid: {
      tokens: {
        current: 2,
        max: 3,
        nextTokenInSeconds: 7200,
        regenDelayInSeconds: 43200
      },
      bombTokens: {
        current: 1,
        max: 1,
        nextTokenInSeconds: null,
        regenDelayInSeconds: 64800
      }
    }
  }
}

const RPC_ROW_PRE_S2 = {
  player_id: 'p1',
  tokens_available: 3,
  token_next_in_seconds: null,
  data_source: 'live'
}

async function setup(opts: {
  keyHolders?: KeyHolderRow[]
  rpcTokenState?: Envelope
  auditSnapshotRows?: AuditInsertRow[]
}) {
  const harness = makeDb({
    keyHolders: opts.keyHolders ?? [MEMBER],
    rpcTokenState: opts.rpcTokenState ?? {
      data: [RPC_ROW_PRE_S2],
      error: null
    },
    auditSnapshotRows: opts.auditSnapshotRows
  })

  const { serviceDb } = await import('@/app/lib/db')
  vi.mocked(serviceDb).mockReturnValue(harness.db as never)

  const { getSeasonTiming } =
    await import('@/app/lib/services/season-timing-service')
  vi.mocked(getSeasonTiming).mockResolvedValue({
    seasonStart: '2026-06-01T00:00:00.000Z'
  } as never)

  const { tacticusAPI } = await import('@/app/lib/api/tacticus-client')
  vi.mocked(tacticusAPI.getPlayerWithRetry).mockResolvedValue(
    LIVE_API_RESPONSE as never
  )

  const { getPlayerApiKey } = await import('@tacticus/app-core/api-key-helper')
  vi.mocked(getPlayerApiKey).mockResolvedValue('decrypted-key')

  const { runTokenAuditForGuild } =
    await import('@/app/lib/token-audit/run-token-audit')
  return { ...harness, runTokenAuditForGuild }
}

async function run(
  runTokenAuditForGuild: Awaited<
    ReturnType<typeof setup>
  >['runTokenAuditForGuild']
) {
  return runTokenAuditForGuild({ guildCode: 'TEST', forceMode: 'daily' })
}

describe('runTokenAuditForGuild snapshot write-back (WI-2640 Phase 3 S1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes back the live reading AFTER the audit row is built, using the pre-writeback snapshot', async () => {
    const { runTokenAuditForGuild, rpc } = await setup({})
    const auditCore = await import('@/app/lib/token-audit/audit-core')
    const buildAuditRowMock = vi.mocked(auditCore.buildAuditRow)

    const summary = await run(runTokenAuditForGuild)

    expect(summary.skipped).toBe(false)
    expect(summary.result?.rows_inserted).toBe(1)

    expect(writeBackMock).toHaveBeenCalledTimes(1)
    expect(writeBackMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        player_id: 'p1',
        last_sync_tokens: 5,
        last_sync_bombs: 2,
        next_token_seconds: 3600,
        next_bomb_seconds: 7200
      }),
      {
        tokensAvailable: 2,
        bombsAvailable: 1,
        tokenNextSeconds: 7200,
        bombNextSeconds: null
      },
      { onlyIfLastSyncBefore: expect.any(String) }
    )
    const guard = writeBackMock.mock.calls[0][3].onlyIfLastSyncBefore
    expect(Number.isNaN(new Date(guard).getTime())).toBe(false)

    const rpcCallIdx = rpc.mock.calls.findIndex(
      (c) => c[0] === 'get_player_token_state'
    )
    expect(rpcCallIdx).toBeGreaterThanOrEqual(0)
    expect(rpc.mock.invocationCallOrder[rpcCallIdx]).toBeLessThan(
      writeBackMock.mock.invocationCallOrder[0]
    )
    expect(buildAuditRowMock.mock.invocationCallOrder[0]).toBeLessThan(
      writeBackMock.mock.invocationCallOrder[0]
    )
  })

  it('interleaves per-member write-backs inside the loop (not batched after it)', async () => {
    const { runTokenAuditForGuild } = await setup({
      keyHolders: [MEMBER, MEMBER_TWO]
    })
    const auditCore = await import('@/app/lib/token-audit/audit-core')
    const buildAuditRowMock = vi.mocked(auditCore.buildAuditRow)

    await run(runTokenAuditForGuild)

    expect(writeBackMock).toHaveBeenCalledTimes(2)
    expect(buildAuditRowMock).toHaveBeenCalledTimes(2)
    expect(buildAuditRowMock.mock.invocationCallOrder[0]).toBeLessThan(
      writeBackMock.mock.invocationCallOrder[0]
    )
    expect(writeBackMock.mock.invocationCallOrder[0]).toBeLessThan(
      buildAuditRowMock.mock.invocationCallOrder[1]
    )
    expect(buildAuditRowMock.mock.invocationCallOrder[1]).toBeLessThan(
      writeBackMock.mock.invocationCallOrder[1]
    )
  })

  it('a write-back failure does not fail the audit run', async () => {
    writeBackMock.mockImplementation(() => {
      throw new Error('boom')
    })
    const { runTokenAuditForGuild, insertedBatches } = await setup({})

    const summary = await run(runTokenAuditForGuild)

    expect(summary.skipped).toBe(false)
    expect(summary.result?.rows_inserted).toBe(1)
    expect(insertedBatches).toHaveLength(1)
  })

  it('omits rpc_post_snapshot_spends when the RPC does not return the field (pre-S2)', async () => {
    const { runTokenAuditForGuild, insertedBatches } = await setup({})

    await run(runTokenAuditForGuild)

    const [rows] = insertedBatches
    expect(rows).toHaveLength(1)
    expect('rpc_post_snapshot_spends' in rows[0]).toBe(false)
  })

  it('includes rpc_post_snapshot_spends on EVERY row when the RPC returns it (homogeneous batch shape)', async () => {
    // Both audit rows must carry the key (null for p2) or the batch insert fails.
    const { runTokenAuditForGuild, insertedBatches } = await setup({
      keyHolders: [MEMBER, MEMBER_TWO],
      rpcTokenState: {
        data: [{ ...RPC_ROW_PRE_S2, post_snapshot_spends: 1 }],
        error: null
      }
    })

    await run(runTokenAuditForGuild)

    const [rows] = insertedBatches
    expect(rows).toHaveLength(2)
    const byPlayer = new Map(rows.map((r) => [r.player_id, r]))
    expect(byPlayer.get('p1')?.rpc_post_snapshot_spends).toBe(1)
    expect('rpc_post_snapshot_spends' in byPlayer.get('p2')!).toBe(true)
    expect(byPlayer.get('p2')?.rpc_post_snapshot_spends).toBeNull()
  })

  it('daily_spacing skip still refreshes snapshots without inserting audit rows (Codex #963 P1)', async () => {
    // decideAuditMode returns null, but the live fetch and write-back must still run.
    const now = new Date('2026-07-01T12:00:00.000Z')
    const { runTokenAuditForGuild, insertedBatches } = await setup({
      auditSnapshotRows: [{ created_at: '2026-07-01T02:00:00.000Z' }]
    })
    const { tacticusAPI } = await import('@/app/lib/api/tacticus-client')
    const auditCore = await import('@/app/lib/token-audit/audit-core')

    const summary = await runTokenAuditForGuild({ guildCode: 'TEST', now })

    expect(summary.skipped).toBe(true)
    expect(summary.reason).toBe('daily_spacing')

    expect(tacticusAPI.getPlayerWithRetry).toHaveBeenCalledTimes(1)
    expect(writeBackMock).toHaveBeenCalledTimes(1)
    expect(writeBackMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ player_id: 'p1' }),
      {
        tokensAvailable: 2,
        bombsAvailable: 1,
        tokenNextSeconds: 7200,
        bombNextSeconds: null
      },
      { onlyIfLastSyncBefore: expect.any(String) }
    )
    expect(vi.mocked(auditCore.buildAuditRow)).not.toHaveBeenCalled()
    expect(insertedBatches).toHaveLength(0)
  })

  it('captures the write-back race cutoff BEFORE initiating the live fetch (Codex #963 P2)', async () => {
    const { runTokenAuditForGuild } = await setup({})
    const { tacticusAPI } = await import('@/app/lib/api/tacticus-client')

    let fetchStartedAtMs = 0
    let fetchResolvedAtMs = 0
    vi.mocked(tacticusAPI.getPlayerWithRetry).mockImplementation(async () => {
      fetchStartedAtMs = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 30))
      fetchResolvedAtMs = Date.now()
      return LIVE_API_RESPONSE as never
    })

    await run(runTokenAuditForGuild)

    expect(writeBackMock).toHaveBeenCalledTimes(1)
    const guard = writeBackMock.mock.calls[0][3].onlyIfLastSyncBefore
    const guardMs = new Date(guard).getTime()
    expect(guardMs).toBeLessThanOrEqual(fetchStartedAtMs)
    // A post-completion cutoff would clobber fresher overlay writes that landed mid-flight.
    expect(guardMs).toBeLessThan(fetchResolvedAtMs)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  serviceDb: vi.fn()
}))

vi.mock('@/app/lib/discord/dm-service', () => ({
  sendDiscordDirectMessage: vi.fn()
}))

vi.mock('@/app/lib/jobs/dispatcher', () => ({
  registerJobHandler: vi.fn(),
  getJobHandler: vi.fn(),
  listRegisteredJobTypes: vi.fn(() => [])
}))

import { serviceDb } from '@/app/lib/db'
import {
  sendDiscordDirectMessage,
  type SendDiscordDirectMessageResult
} from '@/app/lib/discord/dm-service'
import { registerJobHandler } from '@/app/lib/jobs/dispatcher'
import {
  runUserTokenAlertScan,
  MAX_DMS_PER_RUN,
  DM_BLOCK_THRESHOLD
} from '@/app/lib/token-alerts/scan'
import {
  __internal as scanJobInternal,
  registerUserTokenAlertScanHandler
} from '@/app/lib/jobs/user-token-alert-scan'
import type {
  UserTokenAlertPrefs,
  UserTokenAlertState
} from '@/app/lib/token-alerts/types'

const serviceDbMock = vi.mocked(serviceDb)
const sendDmMock = vi.mocked(sendDiscordDirectMessage)
const registerJobHandlerMock = vi.mocked(registerJobHandler)

const NOW_ISO = '2026-07-18T12:00:00.000Z'
const discordOwners = new Map<string, string>()

function stablePositiveInt(value: string): number {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) + 1
}

function discordIdFor(userId: string): string {
  const snowflake = (
    700_000_000_000_000_000n + BigInt(stablePositiveInt(userId))
  ).toString()
  discordOwners.set(snowflake, userId)
  return snowflake
}

type MappingRow = {
  id: number
  user_id: string | null
  player_id: string
  guild_code: string | null
  discord_user_id: string | null
  display_name: string | null
  next_bomb_seconds: number | null
  last_sync_bombs: number | null
  last_sync_at: string | null
}

type RpcRow = {
  player_id: string | null
  tokens_available: number | null
  token_next_in_seconds: number | null
  data_source?: string | null
  bombs_available?: number | null
  bomb_next_in_seconds?: number | null
}

type UpsertRow = Record<string, unknown>

const ZERO_BY_TYPE = {
  full: 0,
  prewarn: 0,
  gained: 0,
  bomb_ready: 0,
  bomb_prewarn: 0,
  pre_quiet: 0,
  burn_prewarn: 0
} as const

const ZERO_WI4000_COUNTERS = {
  quietHoursDeferred: 0,
  quietHoursDropped: 0,
  quietHoursMaxDeferOverrides: 0,
  quietHoursConfigErrors: 0,
  bombReadingsUntrusted: 0
} as const

function prefs(
  userId: string,
  overrides: Partial<UserTokenAlertPrefs> = {}
): UserTokenAlertPrefs {
  return {
    user_id: userId,
    alert_on_full: true,
    alert_on_full_repeat_hours: null,
    alert_before_full: false,
    alert_before_full_minutes: 120,
    alert_on_token_gained: false,
    alert_on_bomb_ready: false,
    alert_before_bomb_ready: false,
    alert_before_bomb_ready_minutes: 120,
    quiet_hours_start: null,
    quiet_hours_end: null,
    quiet_hours_timezone: null,
    alert_before_quiet_hours: false,
    alert_before_quiet_hours_minutes: 30,
    alert_before_burn: false,
    alert_before_burn_minutes: 30,
    ...overrides
  }
}

function mapping(
  userId: string,
  overrides: Partial<MappingRow> = {}
): MappingRow {
  return {
    id: stablePositiveInt(userId),
    user_id: userId,
    player_id: `player-${userId}`,
    guild_code: 'GUILD_A',
    discord_user_id: discordIdFor(userId),
    display_name: userId,
    // Trust-guard inputs default to fresh; an untrusted reading must be explicit.
    next_bomb_seconds: 3600,
    last_sync_bombs: 0,
    last_sync_at: '2026-07-18 11:00:00',
    ...overrides
  }
}

function state(
  userId: string,
  overrides: Partial<UserTokenAlertState> = {}
): UserTokenAlertState {
  return {
    user_id: userId,
    last_tokens: 2,
    last_time_to_full_seconds: 3600,
    last_scan_at: '2026-07-18T11:55:00.000Z',
    last_full_alert_at: null,
    last_prewarn_alert_at: null,
    last_gain_alert_at: null,
    consecutive_dm_failures: 0,
    dm_blocked_at: null,
    dm_channel_id: null,
    dm_channel_recipient_id: null,
    last_bombs: 0,
    last_time_to_bomb_seconds: 3600,
    last_bomb_ready_alert_at: null,
    last_bomb_prewarn_alert_at: null,
    quiet_hours_deferred_since: null,
    capped_since: null,
    last_pre_quiet_alert_at: null,
    last_burn_prewarn_alert_at: null,
    ...overrides
  }
}

function fullRpcRow(userId: string, overrides: Partial<RpcRow> = {}): RpcRow {
  return {
    player_id: `player-${userId}`,
    tokens_available: 3,
    token_next_in_seconds: null,
    data_source: 'live',
    bombs_available: 0,
    bomb_next_in_seconds: 3600,
    ...overrides
  }
}

function quietTokenRpcRow(
  userId: string,
  overrides: Partial<RpcRow> = {}
): RpcRow {
  return {
    player_id: `player-${userId}`,
    tokens_available: 1,
    token_next_in_seconds: 40_000,
    data_source: 'live',
    bombs_available: 0,
    bomb_next_in_seconds: 3600,
    ...overrides
  }
}

const OK_SEND: SendDiscordDirectMessageResult = {
  ok: true,
  channelId: 'chan-default'
}

type Envelope = { data?: unknown; error?: { message: string } | null }

interface Harness {
  db: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }
  upsertedRows: UpsertRow[]
  upsertBatches: UpsertRow[][]
  order: string[]
  rpcCalls: string[]
  selectsByTable: Record<string, string[]>
  fromCountByTable: Record<string, number>
  orFiltersByTable: Record<string, string[]>
  /** Reads are chunked because Kong rejects a long PostgREST query string with 414. */
  inBatchesByTable: Record<string, string[][]>
}

/** Narrows rows to the selected columns so a test cannot pass on a column production never fetched. */
function project(envelope: Envelope, columns: string[] | null): Envelope {
  if (columns == null || !Array.isArray(envelope.data)) return envelope
  const rows = envelope.data as Record<string, unknown>[]
  return {
    ...envelope,
    data: rows.map((row) => {
      const narrowed: Record<string, unknown> = {}
      for (const column of columns) {
        if (column in row) narrowed[column] = row[column]
      }
      return narrowed
    })
  }
}

function restrict(
  envelope: Envelope,
  filter: { column: string; values: string[] } | null
): Envelope {
  if (filter == null || !Array.isArray(envelope.data)) return envelope
  const allowed = new Set(filter.values.map((value) => String(value)))
  const rows = envelope.data as Record<string, unknown>[]
  return {
    ...envelope,
    data: rows.filter((row) => allowed.has(String(row[filter.column])))
  }
}

function makeDb(opts: {
  prefRows?: UserTokenAlertPrefs[]
  prefsError?: { message: string }
  mappingRows?: MappingRow[]
  stateRows?: UserTokenAlertState[]
  rpcByGuild?: Record<string, Envelope>
  upsertError?: { message: string }
  unverifiedDiscordUserIds?: string[]
  order?: string[]
}): Harness {
  const upsertedRows: UpsertRow[] = []
  const upsertBatches: UpsertRow[][] = []
  const order = opts.order ?? []
  const rpcCalls: string[] = []
  const selectsByTable: Record<string, string[]> = {}
  const fromCountByTable: Record<string, number> = {}
  const orFiltersByTable: Record<string, string[]> = {}
  const inBatchesByTable: Record<string, string[][]> = {}

  const from = vi.fn((table: string) => {
    fromCountByTable[table] = (fromCountByTable[table] ?? 0) + 1
    const passthrough = vi.fn(() => chain)
    let selectedColumns: string[] | null = null
    let inFilter: { column: string; values: string[] } | null = null
    const chain: Record<string, unknown> = {
      select: vi.fn((columns?: string) => {
        if (typeof columns === 'string') {
          selectsByTable[table] = [...(selectsByTable[table] ?? []), columns]
          selectedColumns = columns.split(',').map((c) => c.trim())
        }
        return chain
      }),
      or: vi.fn((filter?: string) => {
        if (typeof filter === 'string') {
          orFiltersByTable[table] = [...(orFiltersByTable[table] ?? []), filter]
        }
        return chain
      }),
      in: vi.fn((column?: string, values?: string[]) => {
        if (typeof column === 'string' && Array.isArray(values)) {
          inBatchesByTable[table] = [
            ...(inBatchesByTable[table] ?? []),
            values.map((value) => String(value))
          ]
          inFilter = { column, values }
        }
        return chain
      }),
      eq: passthrough,
      order: passthrough,
      upsert: vi.fn((rows: UpsertRow | UpsertRow[]) => {
        const list = Array.isArray(rows) ? rows : [rows]
        upsertBatches.push(list)
        for (const row of list) {
          upsertedRows.push(row)
          order.push(`upsert:${String(row.user_id)}`)
        }
        return Promise.resolve({
          data: null,
          error: opts.upsertError ?? null
        })
      }),
      then: (
        resolve: (value: Envelope) => void,
        reject?: (reason: unknown) => void
      ) => {
        let envelope: Envelope
        if (table === 'user_token_alert_prefs') {
          envelope = opts.prefsError
            ? { data: null, error: opts.prefsError }
            : { data: opts.prefRows ?? [], error: null }
        } else if (table === 'player_mapping') {
          envelope = { data: opts.mappingRows ?? [], error: null }
        } else if (table === 'user_token_alert_state') {
          envelope = { data: opts.stateRows ?? [], error: null }
        } else {
          throw new Error(`Unexpected table read: ${table}`)
        }
        // Restrict before projecting: PostgREST filters the stored row.
        return Promise.resolve(
          project(restrict(envelope, inFilter), selectedColumns)
        ).then(resolve, reject)
      }
    }
    return chain
  })

  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    if (fn === 'resolve_verified_discord_identities') {
      const requested = new Set(
        Array.isArray(args.p_discord_user_ids)
          ? (args.p_discord_user_ids as string[])
          : []
      )
      const unverified = new Set(opts.unverifiedDiscordUserIds ?? [])
      return Promise.resolve({
        data: (opts.mappingRows ?? [])
          .filter(
            (row) =>
              row.user_id &&
              row.guild_code &&
              row.discord_user_id &&
              requested.has(row.discord_user_id) &&
              !unverified.has(row.discord_user_id)
          )
          .map((row) => ({
            mapping_id: row.id,
            player_id: row.player_id,
            user_id: row.user_id,
            guild_code: row.guild_code,
            role: 'member',
            is_app_admin: false,
            ownership_attestation_id: `attestation-${row.id}`,
            discord_user_id: row.discord_user_id
          })),
        error: null
      })
    }
    if (fn !== 'get_player_token_state') {
      throw new Error(`Unexpected rpc: ${fn}`)
    }
    const guildCode = String(args.p_guild_code)
    rpcCalls.push(guildCode)
    const envelope = opts.rpcByGuild?.[guildCode]
    return Promise.resolve(envelope ?? { data: [], error: null })
  })

  return {
    db: { from, rpc },
    upsertedRows,
    upsertBatches,
    order,
    rpcCalls,
    selectsByTable,
    fromCountByTable,
    orFiltersByTable,
    inBatchesByTable
  }
}

function install(harness: Harness): Harness {
  serviceDbMock.mockReturnValue(
    harness.db as unknown as ReturnType<typeof serviceDb>
  )
  return harness
}

function sendReturning(
  order: string[],
  resultFor: (discordUserId: string) => SendDiscordDirectMessageResult
) {
  sendDmMock.mockImplementation(async (input) => {
    order.push(`send:${discordOwners.get(input.discordUserId) ?? 'unknown'}`)
    return resultFor(input.discordUserId)
  })
}

function rowsFor(harness: Harness, userId: string): UpsertRow[] {
  return harness.upsertedRows.filter((r) => r.user_id === userId)
}

const ALERT_COLUMNS = [
  'last_full_alert_at',
  'last_prewarn_alert_at',
  'last_gain_alert_at'
] as const

function hasAlertTimestamp(row: UpsertRow): boolean {
  return ALERT_COLUMNS.some((c) => row[c] != null)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW_ISO))
  sendDmMock.mockResolvedValue(OK_SEND)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runUserTokenAlertScan — state projection completeness', () => {
  it('selects every user_token_alert_state column the scan later reads', async () => {
    // Without `dm_channel_recipient_id` in the select the reuse guard never runs.
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1')],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )
    sendDmMock.mockResolvedValue(OK_SEND)

    await runUserTokenAlertScan()

    const projections = harness.selectsByTable.user_token_alert_state ?? []
    expect(projections.length).toBeGreaterThan(0)
    const selected = projections.join(',')
    for (const column of [
      'dm_channel_id',
      'dm_channel_recipient_id',
      'consecutive_dm_failures',
      'dm_blocked_at',
      'last_full_alert_at',
      'last_prewarn_alert_at',
      'last_gain_alert_at'
    ]) {
      expect(selected).toContain(column)
    }
  })
})

describe('runUserTokenAlertScan — chunked user_id fan-out', () => {
  /** Mirrors scan.ts USER_ID_CHUNK_SIZE; assertions tolerate re-tuning. */
  const CHUNK_CAP = 200
  const COHORT = 250

  const cohortIds = Array.from(
    { length: COHORT },
    (_, i) => `u${String(i).padStart(3, '0')}`
  )
  const lastId = cohortIds[cohortIds.length - 1]

  function bigCohortDb() {
    return makeDb({
      prefRows: cohortIds.map((id) => prefs(id)),
      mappingRows: cohortIds.map((id) => mapping(id)),
      stateRows: cohortIds.map((id) => state(id)),
      rpcByGuild: {
        GUILD_A: {
          data: cohortIds.map((id) =>
            id === lastId ? fullRpcRow(id) : quietTokenRpcRow(id)
          ),
          error: null
        }
      }
    })
  }

  it('splits BOTH fan-out reads into batches within the request-line budget', async () => {
    // Both reads precede the send loop, so one 414 would deliver zero alerts.
    const harness = install(bigCohortDb())
    sendDmMock.mockResolvedValue(OK_SEND)

    await runUserTokenAlertScan()

    for (const table of ['player_mapping', 'user_token_alert_state']) {
      const batches = harness.inBatchesByTable[table] ?? []
      expect(batches.length).toBeGreaterThan(1)
      for (const batch of batches) {
        expect(batch.length).toBeLessThanOrEqual(CHUNK_CAP)
      }
      // Batches must partition the cohort; a gap silently drops users.
      expect(batches.flat().sort()).toEqual([...cohortIds].sort())
    }
  })

  it('keeps the WI-4000 columns in EVERY batch of the chunked selects', async () => {
    // Bomb trust columns stay in the batched select; dropping them makes every bomb reading untrusted.
    const harness = install(bigCohortDb())
    sendDmMock.mockResolvedValue(OK_SEND)

    await runUserTokenAlertScan()

    const mappingSelects = harness.selectsByTable.player_mapping ?? []
    expect(mappingSelects.length).toBe(
      (harness.inBatchesByTable.player_mapping ?? []).length
    )
    for (const projection of mappingSelects) {
      expect(projection).toContain('next_bomb_seconds')
      expect(projection).toContain('last_sync_bombs')
      expect(projection).toContain('last_sync_at')
    }

    const stateSelects = harness.selectsByTable.user_token_alert_state ?? []
    expect(stateSelects.length).toBe(
      (harness.inBatchesByTable.user_token_alert_state ?? []).length
    )
    for (const projection of stateSelects) {
      expect(projection).toContain('dm_channel_recipient_id')
    }
  })

  it('delivers for a user in a LATER batch — the rows really reassemble', async () => {
    const harness = install(bigCohortDb())
    sendDmMock.mockResolvedValue(OK_SEND)

    const summary = await runUserTokenAlertScan()

    expect(summary.scannedUsers).toBe(COHORT)
    expect(summary.alertsSent).toBe(1)
    expect(sendDmMock).toHaveBeenCalledTimes(1)
    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({ discordUserId: discordIdFor(lastId) })
    )
    expect(harness.upsertedRows.some((row) => row.user_id === lastId)).toBe(
      true
    )
  })
})

describe('runUserTokenAlertScan — projection fan-out', () => {
  it('issues exactly one get_player_token_state RPC per DISTINCT guild', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1'), prefs('u2'), prefs('u3')],
        mappingRows: [
          mapping('u1', { guild_code: 'GUILD_A' }),
          mapping('u2', { guild_code: 'GUILD_A' }),
          mapping('u3', { guild_code: 'GUILD_B' })
        ],
        stateRows: [state('u1'), state('u2'), state('u3')],
        rpcByGuild: {
          GUILD_A: {
            data: [fullRpcRow('u1'), fullRpcRow('u2')],
            error: null
          },
          GUILD_B: { data: [fullRpcRow('u3')], error: null }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(harness.rpcCalls).toHaveLength(2)
    expect(harness.rpcCalls.sort()).toEqual(['GUILD_A', 'GUILD_B'])
    expect(harness.db.rpc).toHaveBeenCalledWith('get_player_token_state', {
      p_guild_code: 'GUILD_A'
    })
    expect(harness.db.rpc).toHaveBeenCalledWith('get_player_token_state', {
      p_guild_code: 'GUILD_B'
    })
    expect(summary.scannedUsers).toBe(3)
    expect(summary.alertsSent).toBe(3)
  })

  it('returns the zero summary with no RPC and no DM when nobody is opted in', async () => {
    const harness = install(makeDb({ prefRows: [] }))

    const summary = await runUserTokenAlertScan()

    expect(summary).toEqual({
      scannedUsers: 0,
      alertsSent: 0,
      byType: ZERO_BY_TYPE,
      dmBlocked: 0,
      rateLimited: 0,
      errors: 0,
      ...ZERO_WI4000_COUNTERS
    })
    expect(harness.db.rpc).not.toHaveBeenCalled()
    expect(sendDmMock).not.toHaveBeenCalled()
    expect(harness.upsertedRows).toHaveLength(0)
  })
})

describe('runUserTokenAlertScan — at-least-once ordering', () => {
  it('persists each user state IMMEDIATELY after their send, before the next send', async () => {
    const order: string[] = []
    const harness = install(
      makeDb({
        order,
        prefRows: [prefs('A'), prefs('B')],
        mappingRows: [mapping('A'), mapping('B')],
        stateRows: [state('A'), state('B')],
        rpcByGuild: {
          GUILD_A: { data: [fullRpcRow('A'), fullRpcRow('B')], error: null }
        }
      })
    )
    sendReturning(order, () => OK_SEND)

    await runUserTokenAlertScan()

    expect(order).toEqual(['send:A', 'upsert:A', 'send:B', 'upsert:B'])
    expect(order.indexOf('upsert:A')).toBeLessThan(order.indexOf('send:B'))
    expect(harness.upsertedRows).toHaveLength(2)
  })
})

describe('runUserTokenAlertScan — successful send state write', () => {
  it('writes alert timestamp, observation, reset failures, and the channel id', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { consecutive_dm_failures: 2 })],
        rpcByGuild: {
          GUILD_A: { data: [fullRpcRow('u1')], error: null }
        }
      })
    )
    sendDmMock.mockResolvedValue({ ok: true, channelId: 'chan-777' })

    const summary = await runUserTokenAlertScan()

    const rows = rowsFor(harness, 'u1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      user_id: 'u1',
      last_full_alert_at: NOW_ISO,
      last_tokens: 3,
      last_time_to_full_seconds: 0,
      last_scan_at: NOW_ISO,
      consecutive_dm_failures: 0,
      dm_blocked_at: null,
      dm_channel_id: 'chan-777'
    })
    expect(rows[0].last_prewarn_alert_at).toBeUndefined()
    expect(rows[0].last_gain_alert_at).toBeUndefined()
    expect(summary.alertsSent).toBe(1)
    expect(summary.byType.full).toBe(1)
  })

  it('repeats the existing full alert while still capped and advances its delivery stamp', async () => {
    const twelveHoursAgo = new Date(
      new Date(NOW_ISO).getTime() - 12 * 60 * 60 * 1000
    ).toISOString()
    const harness = install(
      makeDb({
        prefRows: [
          prefs('u1', {
            alert_on_full_repeat_hours: 12
          })
        ],
        mappingRows: [mapping('u1')],
        stateRows: [
          state('u1', {
            last_tokens: 3,
            last_full_alert_at: twelveHoursAgo
          })
        ],
        rpcByGuild: {
          GUILD_A: { data: [fullRpcRow('u1')], error: null }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.byType.full).toBe(1)
    expect(sendDmMock).toHaveBeenCalledTimes(1)
    expect(rowsFor(harness, 'u1')[0]).toMatchObject({
      last_full_alert_at: NOW_ISO,
      last_tokens: 3
    })
    expect((harness.selectsByTable.user_token_alert_prefs ?? [])[0]).toContain(
      'alert_on_full_repeat_hours'
    )
  })

  it('stamps last_prewarn_alert_at for a prewarn decision', async () => {
    const harness = install(
      makeDb({
        prefRows: [
          prefs('u1', {
            alert_on_full: false,
            alert_before_full: true,
            alert_before_full_minutes: 120
          })
        ],
        mappingRows: [mapping('u1')],
        stateRows: [
          state('u1', { last_tokens: 2, last_time_to_full_seconds: 40000 })
        ],
        rpcByGuild: {
          GUILD_A: {
            data: [
              {
                player_id: 'player-u1',
                tokens_available: 2,
                token_next_in_seconds: 1800
              }
            ],
            error: null
          }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.byType.prewarn).toBe(1)
    const rows = rowsFor(harness, 'u1')
    expect(rows[0].last_prewarn_alert_at).toBe(NOW_ISO)
    expect(rows[0].last_full_alert_at).toBeUndefined()
  })

  it('stamps last_gain_alert_at for a gained decision', async () => {
    const harness = install(
      makeDb({
        prefRows: [
          prefs('u1', { alert_on_full: false, alert_on_token_gained: true })
        ],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { last_tokens: 1 })],
        rpcByGuild: {
          GUILD_A: {
            data: [
              {
                player_id: 'player-u1',
                tokens_available: 2,
                token_next_in_seconds: 3600
              }
            ],
            error: null
          }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.byType.gained).toBe(1)
    const rows = rowsFor(harness, 'u1')
    expect(rows[0].last_gain_alert_at).toBe(NOW_ISO)
  })
})

describe('runUserTokenAlertScan — non-recipients', () => {
  it('never DMs a user with no linked discord_user_id, but advances observation', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1', { discord_user_id: null })],
        stateRows: [state('u1')],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(sendDmMock).not.toHaveBeenCalled()
    expect(summary.alertsSent).toBe(0)
    const rows = rowsFor(harness, 'u1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ last_tokens: 3, last_scan_at: NOW_ISO })
    expect(hasAlertTimestamp(rows[0])).toBe(false)
  })

  it('never DMs a stored Discord candidate without canonical verification', async () => {
    const unverifiedId = discordIdFor('u1')
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1')],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } },
        unverifiedDiscordUserIds: [unverifiedId]
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(sendDmMock).not.toHaveBeenCalled()
    expect(summary.alertsSent).toBe(0)
    expect(rowsFor(harness, 'u1')).toEqual([
      expect.objectContaining({ user_id: 'u1', last_tokens: 3 })
    ])
  })

  it('never DMs a user whose state has dm_blocked_at set, but advances observation', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [
          state('u1', {
            dm_blocked_at: '2026-07-01T00:00:00.000Z',
            consecutive_dm_failures: 3
          })
        ],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(sendDmMock).not.toHaveBeenCalled()
    expect(summary.alertsSent).toBe(0)
    const rows = rowsFor(harness, 'u1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ last_tokens: 3 })
    expect(hasAlertTimestamp(rows[0])).toBe(false)
  })

  it('never DMs a user with no is_current player_mapping row', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [],
        stateRows: [state('u1')],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(sendDmMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ scannedUsers: 0, alertsSent: 0, errors: 0 })
    expect(harness.upsertedRows).toHaveLength(0)
  })

  it('never DMs a user whose guild projection has no row for their player_id', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1')],
        rpcByGuild: {
          GUILD_A: { data: [fullRpcRow('someone-else')], error: null }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(sendDmMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ scannedUsers: 0, alertsSent: 0, errors: 0 })
    expect(harness.upsertedRows).toHaveLength(0)
  })
})

describe('runUserTokenAlertScan — dm_blocked accounting', () => {
  it('increments consecutive_dm_failures 1 -> 2 without setting dm_blocked_at', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { consecutive_dm_failures: 1 })],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )
    sendDmMock.mockResolvedValue({
      ok: false,
      reason: 'dm_blocked',
      status: 403
    })

    const summary = await runUserTokenAlertScan()

    expect(summary.dmBlocked).toBe(1)
    expect(summary.alertsSent).toBe(0)
    const rows = rowsFor(harness, 'u1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      consecutive_dm_failures: 2,
      dm_blocked_at: null
    })
    expect(hasAlertTimestamp(rows[0])).toBe(false)
  })

  it('sets dm_blocked_at once failures reach DM_BLOCK_THRESHOLD (2 -> 3)', async () => {
    expect(DM_BLOCK_THRESHOLD).toBe(3)
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { consecutive_dm_failures: 2 })],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )
    sendDmMock.mockResolvedValue({
      ok: false,
      reason: 'dm_blocked',
      status: 403
    })

    const summary = await runUserTokenAlertScan()

    expect(summary.dmBlocked).toBe(1)
    const rows = rowsFor(harness, 'u1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      consecutive_dm_failures: DM_BLOCK_THRESHOLD,
      dm_blocked_at: NOW_ISO
    })
  })
})

describe('runUserTokenAlertScan — rate limiting', () => {
  it('counts the rate limit and stops sending for the rest of the run', async () => {
    const order: string[] = []
    const harness = install(
      makeDb({
        order,
        prefRows: [prefs('A'), prefs('B')],
        mappingRows: [mapping('A'), mapping('B')],
        stateRows: [state('A'), state('B')],
        rpcByGuild: {
          GUILD_A: { data: [fullRpcRow('A'), fullRpcRow('B')], error: null }
        }
      })
    )
    sendReturning(order, (discordUserId) =>
      discordUserId === discordIdFor('A')
        ? { ok: false, reason: 'rate_limited', retryAfterMs: 5000 }
        : OK_SEND
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.rateLimited).toBe(1)
    expect(summary.alertsSent).toBe(0)
    expect(sendDmMock).toHaveBeenCalledTimes(1)
    expect(order.filter((e) => e.startsWith('send:'))).toEqual(['send:A'])
    for (const row of rowsFor(harness, 'B')) {
      expect(hasAlertTimestamp(row)).toBe(false)
    }
  })
})

describe('runUserTokenAlertScan — send cap', () => {
  it('sends at most MAX_DMS_PER_RUN messages', async () => {
    expect(MAX_DMS_PER_RUN).toBe(100)
    const count = MAX_DMS_PER_RUN + 25
    const users = Array.from({ length: count }, (_, i) => `u${i}`)
    const harness = install(
      makeDb({
        prefRows: users.map((u) => prefs(u)),
        mappingRows: users.map((u) => mapping(u)),
        stateRows: users.map((u) => state(u)),
        rpcByGuild: {
          GUILD_A: { data: users.map((u) => fullRpcRow(u)), error: null }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(sendDmMock).toHaveBeenCalledTimes(MAX_DMS_PER_RUN)
    expect(summary.alertsSent).toBe(MAX_DMS_PER_RUN)
    expect(summary.scannedUsers).toBe(count)
    const stamped = harness.upsertedRows.filter(hasAlertTimestamp)
    expect(stamped).toHaveLength(MAX_DMS_PER_RUN)
  })
})

describe('runUserTokenAlertScan — per-guild failure isolation', () => {
  it('skips a failed guild, counts one error, and still processes other guilds', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1'), prefs('u2')],
        mappingRows: [
          mapping('u1', { guild_code: 'GUILD_A' }),
          mapping('u2', { guild_code: 'GUILD_B' })
        ],
        stateRows: [state('u1'), state('u2')],
        rpcByGuild: {
          GUILD_A: { data: null, error: { message: 'boom' } },
          GUILD_B: { data: [fullRpcRow('u2')], error: null }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.errors).toBe(1)
    expect(summary.scannedUsers).toBe(1)
    expect(summary.alertsSent).toBe(1)
    expect(sendDmMock).toHaveBeenCalledTimes(1)
    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({ discordUserId: discordIdFor('u2') })
    )
    expect(rowsFor(harness, 'u1')).toHaveLength(0)
  })
})

describe('runUserTokenAlertScan — transport failures', () => {
  it('catches a thrown send, counts an error, leaves state unstamped, and continues', async () => {
    const order: string[] = []
    const harness = install(
      makeDb({
        order,
        prefRows: [prefs('A'), prefs('B')],
        mappingRows: [mapping('A'), mapping('B')],
        stateRows: [state('A'), state('B')],
        rpcByGuild: {
          GUILD_A: { data: [fullRpcRow('A'), fullRpcRow('B')], error: null }
        }
      })
    )
    sendDmMock.mockImplementation(async (input) => {
      order.push(`send:${discordOwners.get(input.discordUserId) ?? 'unknown'}`)
      if (input.discordUserId === discordIdFor('A')) {
        throw new Error('socket hang up')
      }
      return OK_SEND
    })

    const summary = await runUserTokenAlertScan()

    expect(summary.errors).toBe(1)
    expect(summary.alertsSent).toBe(1)
    expect(order.filter((e) => e.startsWith('send:'))).toEqual([
      'send:A',
      'send:B'
    ])
    for (const row of rowsFor(harness, 'A')) {
      expect(hasAlertTimestamp(row)).toBe(false)
    }
    expect(rowsFor(harness, 'B').some(hasAlertTimestamp)).toBe(true)
  })
})

describe('runUserTokenAlertScan — cached DM channel', () => {
  it('passes the user state dm_channel_id as cachedChannelId when it belongs to the linked account', async () => {
    install(
      makeDb({
        prefRows: [prefs('u1'), prefs('u2')],
        mappingRows: [mapping('u1'), mapping('u2')],
        stateRows: [
          state('u1', {
            dm_channel_id: 'cached-chan-1',
            dm_channel_recipient_id: discordIdFor('u1')
          }),
          state('u2', { dm_channel_id: null })
        ],
        rpcByGuild: {
          GUILD_A: { data: [fullRpcRow('u1'), fullRpcRow('u2')], error: null }
        }
      })
    )

    await runUserTokenAlertScan()

    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discordUserId: discordIdFor('u1'),
        cachedChannelId: 'cached-chan-1'
      })
    )
    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discordUserId: discordIdFor('u2'),
        cachedChannelId: null
      })
    )
  })

  // A relinked Discord account must not reuse the stale channel; the match is a positive control.
  it('ignores a cached channel opened for a DIFFERENT Discord account, but reuses a matching one', async () => {
    install(
      makeDb({
        prefRows: [prefs('stale'), prefs('match')],
        mappingRows: [mapping('stale'), mapping('match')],
        stateRows: [
          state('stale', {
            dm_channel_id: 'chan-for-old-account',
            dm_channel_recipient_id: discordIdFor('old-account')
          }),
          state('match', {
            dm_channel_id: 'chan-still-valid',
            dm_channel_recipient_id: discordIdFor('match')
          })
        ],
        rpcByGuild: {
          GUILD_A: {
            data: [fullRpcRow('stale'), fullRpcRow('match')],
            error: null
          }
        }
      })
    )

    await runUserTokenAlertScan()

    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discordUserId: discordIdFor('stale'),
        cachedChannelId: null
      })
    )
    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discordUserId: discordIdFor('match'),
        cachedChannelId: 'chan-still-valid'
      })
    )
  })

  it('records the recipient the channel was opened for on a successful send', async () => {
    const h = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [],
        rpcByGuild: {
          GUILD_A: { data: [fullRpcRow('u1')], error: null }
        }
      })
    )

    await runUserTokenAlertScan()

    expect(h.upsertedRows).toContainEqual(
      expect.objectContaining({
        user_id: 'u1',
        dm_channel_recipient_id: discordIdFor('u1')
      })
    )
  })
})

describe('runUserTokenAlertScan — DM content', () => {
  it("mentions 3/3 for a 'full' alert and always ends with the manage-alerts line", async () => {
    install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1')],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    await runUserTokenAlertScan()

    const content = sendDmMock.mock.calls[0][0].content
    expect(content).toContain('3/3')
    const lines = content.split('\n')
    expect(lines[lines.length - 1]).toMatch(/^Manage these alerts: https?:\/\//)
  })

  it('ends every alert type with the manage-alerts line', async () => {
    install(
      makeDb({
        prefRows: [
          prefs('u1'),
          prefs('u2', {
            alert_on_full: false,
            alert_before_full: true,
            alert_before_full_minutes: 120
          }),
          prefs('u3', { alert_on_full: false, alert_on_token_gained: true })
        ],
        mappingRows: [mapping('u1'), mapping('u2'), mapping('u3')],
        stateRows: [
          state('u1'),
          state('u2', { last_tokens: 2, last_time_to_full_seconds: 40000 }),
          state('u3', { last_tokens: 1 })
        ],
        rpcByGuild: {
          GUILD_A: {
            data: [
              fullRpcRow('u1'),
              {
                player_id: 'player-u2',
                tokens_available: 2,
                token_next_in_seconds: 1800
              },
              {
                player_id: 'player-u3',
                tokens_available: 2,
                token_next_in_seconds: 3600
              }
            ],
            error: null
          }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.alertsSent).toBe(3)
    expect(sendDmMock).toHaveBeenCalledTimes(3)
    for (const [input] of sendDmMock.mock.calls) {
      const lines = input.content.split('\n')
      expect(lines[lines.length - 1]).toMatch(
        /^Manage these alerts: https?:\/\//
      )
    }
  })
})

describe('user-token-alert-scan work_queue handler', () => {
  it("registers under the exact job type 'user-token-alert-scan'", () => {
    registerUserTokenAlertScanHandler()

    expect(registerJobHandlerMock).toHaveBeenCalledTimes(1)
    expect(registerJobHandlerMock).toHaveBeenCalledWith(
      'user-token-alert-scan',
      expect.any(Function)
    )
    expect(registerJobHandlerMock.mock.calls[0][0]).toBe(
      'user-token-alert-scan'
    )
    expect(registerJobHandlerMock.mock.calls[0][1]).toBe(
      scanJobInternal.userTokenAlertScanHandler
    )
  })

  it('returns the scan summary as the job result payload', async () => {
    install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1')],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const result = await scanJobInternal.userTokenAlertScanHandler(
      {},
      { jobId: 1, workerId: 'test-worker', attempts: 0 }
    )

    expect(result).toEqual({
      scannedUsers: 1,
      alertsSent: 1,
      byType: { ...ZERO_BY_TYPE, full: 1 },
      dmBlocked: 0,
      rateLimited: 0,
      errors: 0,
      ...ZERO_WI4000_COUNTERS
    })
  })
})

function bombOnlyPrefs(
  userId: string,
  overrides: Partial<UserTokenAlertPrefs> = {}
): UserTokenAlertPrefs {
  return prefs(userId, {
    alert_on_full: false,
    alert_on_bomb_ready: true,
    ...overrides
  })
}

function bombReadyRow(userId: string, overrides: Partial<RpcRow> = {}): RpcRow {
  return quietTokenRpcRow(userId, {
    bombs_available: 1,
    bomb_next_in_seconds: null,
    ...overrides
  })
}

describe('WI-4000 — bomb data rides the existing queries (no N+1)', () => {
  it('reads the bomb trust columns from the ONE player_mapping select', async () => {
    const harness = install(
      makeDb({
        prefRows: [bombOnlyPrefs('u1'), bombOnlyPrefs('u2')],
        mappingRows: [mapping('u1'), mapping('u2')],
        stateRows: [state('u1'), state('u2')],
        rpcByGuild: {
          GUILD_A: {
            data: [bombReadyRow('u1'), bombReadyRow('u2')],
            error: null
          }
        }
      })
    )

    await runUserTokenAlertScan()

    expect(harness.fromCountByTable.player_mapping).toBe(1)
    const [mappingSelect] = harness.selectsByTable.player_mapping
    expect(mappingSelect).toContain('next_bomb_seconds')
    expect(mappingSelect).toContain('last_sync_bombs')
    expect(mappingSelect).toContain('last_sync_at')
    expect(harness.rpcCalls).toHaveLength(1)
  })

  it('opts bomb-only users in — the prefs filter names both bomb toggles', async () => {
    const harness = install(
      makeDb({
        prefRows: [bombOnlyPrefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1')],
        rpcByGuild: { GUILD_A: { data: [bombReadyRow('u1')], error: null } }
      })
    )

    await runUserTokenAlertScan()

    const [orFilter] = harness.orFiltersByTable.user_token_alert_prefs
    expect(orFilter).toContain('alert_on_bomb_ready.eq.true')
    expect(orFilter).toContain('alert_before_bomb_ready.eq.true')
    // Quiet hours suppress, never enable; alert_before_quiet_hours is a delivery toggle.
    expect(orFilter).not.toContain('quiet_hours_start')
    expect(orFilter).not.toContain('quiet_hours_end')
    expect(orFilter).not.toContain('quiet_hours_timezone')
    // Delivery toggles must be here and in the cron guard, or that cohort gets nothing.
    expect(orFilter).toContain('alert_before_quiet_hours.eq.true')
    expect(orFilter).toContain('alert_before_burn.eq.true')
    expect(sendDmMock).toHaveBeenCalledTimes(1)
  })
})

describe('WI-4000 — bomb delivery and its own state columns', () => {
  it('sends the bomb copy and stamps the BOMB timestamp column', async () => {
    const harness = install(
      makeDb({
        prefRows: [bombOnlyPrefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1')],
        rpcByGuild: { GUILD_A: { data: [bombReadyRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.alertsSent).toBe(1)
    expect(summary.byType.bomb_ready).toBe(1)
    expect(sendDmMock.mock.calls[0][0].content).toContain('bomb is ready')

    const [row] = rowsFor(harness, 'u1')
    expect(row.last_bomb_ready_alert_at).toBe(NOW_ISO)
    // A shared column would let a token-full DM re-arm or suppress bomb hysteresis.
    expect(row.last_full_alert_at).toBeUndefined()
    expect(row.last_bombs).toBe(1)
  })

  it('sends the bomb PRE-warning using the projection time-to-ready', async () => {
    install(
      makeDb({
        prefRows: [
          bombOnlyPrefs('u1', {
            alert_on_bomb_ready: false,
            alert_before_bomb_ready: true,
            alert_before_bomb_ready_minutes: 120
          })
        ],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { last_time_to_bomb_seconds: 40_000 })],
        rpcByGuild: {
          GUILD_A: {
            data: [quietTokenRpcRow('u1', { bomb_next_in_seconds: 3600 })],
            error: null
          }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.byType.bomb_prewarn).toBe(1)
    expect(sendDmMock.mock.calls[0][0].content).toContain('ready in about 1h')
  })
})

describe('WI-4000 — the bomb trust guard', () => {
  const untrustedCases: Array<{
    name: string
    mappingOverride?: Partial<MappingRow>
    rpcOverride?: Partial<RpcRow>
  }> = [
    {
      name: "data_source is not 'live' (RPC used its coalesce fallback)",
      rpcOverride: { data_source: 'snapshot' }
    },
    {
      name: 'player_mapping.next_bomb_seconds is NULL (no projection basis)',
      mappingOverride: { next_bomb_seconds: null }
    },
    {
      name: 'the mapping sync is older than 24h',
      mappingOverride: { last_sync_at: '2026-07-16 12:00:00' }
    },
    {
      name: 'the mapping has never synced',
      mappingOverride: { last_sync_at: null }
    }
  ]

  for (const testCase of untrustedCases) {
    it(`sends NO bomb DM when ${testCase.name}`, async () => {
      const harness = install(
        makeDb({
          prefRows: [bombOnlyPrefs('u1')],
          mappingRows: [mapping('u1', testCase.mappingOverride ?? {})],
          stateRows: [state('u1')],
          rpcByGuild: {
            GUILD_A: {
              data: [bombReadyRow('u1', testCase.rpcOverride ?? {})],
              error: null
            }
          }
        })
      )

      const summary = await runUserTokenAlertScan()

      expect(sendDmMock).not.toHaveBeenCalled()
      expect(summary.byType.bomb_ready).toBe(0)
      expect(summary.bombReadingsUntrusted).toBe(1)
      // Persisting an untrusted amount would poison the next trusted crossing check.
      const [row] = rowsFor(harness, 'u1')
      expect(row.last_bombs).toBe(state('u1').last_bombs)
    })
  }

  it('leaves TOKEN alerts completely unaffected by an untrusted bomb reading', async () => {
    install(
      makeDb({
        prefRows: [prefs('u1', { alert_on_bomb_ready: true })],
        mappingRows: [mapping('u1', { next_bomb_seconds: null })],
        stateRows: [state('u1')],
        rpcByGuild: {
          GUILD_A: {
            data: [fullRpcRow('u1', { bombs_available: 1 })],
            error: null
          }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.byType.full).toBe(1)
    expect(summary.byType.bomb_ready).toBe(0)
    expect(summary.bombReadingsUntrusted).toBe(1)
  })
})

describe('WI-4000 — quiet hours and the freeze/advance contract', () => {
  const NIGHT_ISO = '2026-07-18T02:00:00.000Z'

  const quietPrefs = (
    userId: string,
    overrides: Partial<UserTokenAlertPrefs> = {}
  ) =>
    prefs(userId, {
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      quiet_hours_timezone: 'UTC',
      ...overrides
    })

  it('DEFERS a persistent alert overnight and FREEZES the token baseline', async () => {
    vi.setSystemTime(new Date(NIGHT_ISO))
    const harness = install(
      makeDb({
        prefRows: [quietPrefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { last_tokens: 2 })],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(sendDmMock).not.toHaveBeenCalled()
    expect(summary.quietHoursDeferred).toBe(1)

    const [row] = rowsFor(harness, 'u1')
    // The baseline must not advance, or the crossing is consumed and the deferred DM never fires.
    expect(row.last_tokens).toBe(2)
    expect(row.quiet_hours_deferred_since).toBe(NIGHT_ISO)
  })

  it('DROPS a transient gained alert overnight and ADVANCES the baseline', async () => {
    vi.setSystemTime(new Date(NIGHT_ISO))
    const harness = install(
      makeDb({
        prefRows: [
          quietPrefs('u1', {
            alert_on_full: false,
            alert_on_token_gained: true
          })
        ],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { last_tokens: 1 })],
        rpcByGuild: {
          GUILD_A: {
            data: [quietTokenRpcRow('u1', { tokens_available: 2 })],
            error: null
          }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(sendDmMock).not.toHaveBeenCalled()
    expect(summary.quietHoursDropped).toBe(1)
    const [row] = rowsFor(harness, 'u1')
    // Dropped, not deferred, so the morning is not a burst of stale DMs.
    expect(row.last_tokens).toBe(2)
    expect(row.quiet_hours_deferred_since).toBeNull()
  })

  it('delivers normally OUTSIDE the quiet window and clears the defer anchor', async () => {
    const harness = install(
      makeDb({
        prefRows: [quietPrefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [
          state('u1', {
            quiet_hours_deferred_since: '2026-07-18T02:00:00.000Z'
          })
        ],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.alertsSent).toBe(1)
    const [row] = rowsFor(harness, 'u1')
    expect(row.quiet_hours_deferred_since).toBeNull()
  })

  it('freezes the BOMB baseline when a token alert wins precedence', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1', { alert_on_bomb_ready: true })],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { last_tokens: 2, last_bombs: 0 })],
        rpcByGuild: {
          GUILD_A: {
            data: [fullRpcRow('u1', { bombs_available: 1 })],
            error: null
          }
        }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.byType.full).toBe(1)
    expect(summary.byType.bomb_ready).toBe(0)
    const [row] = rowsFor(harness, 'u1')
    expect(row.last_tokens).toBe(3)
    expect(row.last_bombs).toBe(0)
  })
})

describe('WI-4000 — batched upserts stay column-uniform', () => {
  it('sends an IDENTICAL column set for every row of a batch', async () => {
    vi.setSystemTime(new Date('2026-07-18T02:00:00.000Z'))
    const harness = install(
      makeDb({
        prefRows: [
          prefs('u1', {
            quiet_hours_start: 22,
            quiet_hours_end: 7,
            quiet_hours_timezone: 'UTC'
          }),
          prefs('u2', { alert_on_full: false }),
          prefs('u3', { alert_on_full: false })
        ],
        mappingRows: [
          mapping('u1', { discord_user_id: null }),
          mapping('u2', { discord_user_id: null }),
          mapping('u3', { discord_user_id: null })
        ],
        stateRows: [state('u1'), state('u2'), state('u3')],
        rpcByGuild: {
          GUILD_A: {
            data: [fullRpcRow('u1'), quietTokenRpcRow('u2'), fullRpcRow('u3')],
            error: null
          }
        }
      })
    )

    await runUserTokenAlertScan()

    const batches = harness.upsertBatches.filter((b) => b.length > 1)
    expect(batches.length).toBeGreaterThan(0)
    for (const batch of batches) {
      const signatures = batch.map((row) => Object.keys(row).sort().join(','))
      // PostgREST sends NULL for keys missing from some batch rows, so every row carries every column.
      expect(new Set(signatures).size).toBe(1)
      for (const row of batch) {
        expect(row).toHaveProperty('last_tokens')
        expect(row).toHaveProperty('last_bombs')
        expect(row).toHaveProperty('quiet_hours_deferred_since')
      }
    }
  })
})

/** NOW_ISO is 08:00 in America/New_York (EDT), so a 09:00 window is 60m off. */
const EDT_ZONE = 'America/New_York'

describe('WI-4970 — the reconstructed burn anchor is persisted', () => {
  it('back-dates capped_since to the crossing, not to the tick that saw it', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1')],
        mappingRows: [mapping('u1')],
        stateRows: [
          state('u1', {
            last_tokens: 2,
            last_scan_at: '2026-07-18T11:55:00.000Z',
            last_time_to_full_seconds: 120
          })
        ],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    await runUserTokenAlertScan()

    const [row] = rowsFor(harness, 'u1')
    expect(row.capped_since).toBe('2026-07-18T11:57:00.000Z')
  })

  it('clears capped_since the moment the player drops below cap', async () => {
    const harness = install(
      makeDb({
        prefRows: [prefs('u1', { alert_on_full: false })],
        mappingRows: [mapping('u1')],
        stateRows: [
          state('u1', {
            last_tokens: 3,
            capped_since: '2026-07-18T10:00:00.000Z'
          })
        ],
        rpcByGuild: { GUILD_A: { data: [quietTokenRpcRow('u1')], error: null } }
      })
    )

    await runUserTokenAlertScan()

    const [row] = rowsFor(harness, 'u1')
    expect(row.capped_since).toBeNull()
  })

  it('sends nothing when the player is capped with no observed crossing', async () => {
    const harness = install(
      makeDb({
        prefRows: [
          prefs('u1', { alert_on_full: false, alert_before_burn: true })
        ],
        mappingRows: [mapping('u1')],
        stateRows: [state('u1', { last_tokens: 3, capped_since: null })],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.alertsSent).toBe(0)
    expect(sendDmMock).not.toHaveBeenCalled()
    const [row] = rowsFor(harness, 'u1')
    expect(row.capped_since).toBeNull()
  })
})

describe('WI-4970 — pre-burn and pre-quiet delivery', () => {
  it('sends the burn warning and stamps its OWN column', async () => {
    const harness = install(
      makeDb({
        prefRows: [
          prefs('u1', {
            alert_on_full: false,
            alert_before_burn: true,
            alert_before_burn_minutes: 30
          })
        ],
        mappingRows: [mapping('u1')],
        stateRows: [
          state('u1', {
            last_tokens: 3,
            capped_since: '2026-07-18T00:20:00.000Z'
          })
        ],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.byType.burn_prewarn).toBe(1)
    // This DM reports an irreversible loss, so it must say BURN.
    expect(sendDmMock.mock.calls[0][0].content).toContain(
      "You'll BURN a raid token in about 20m"
    )

    const [row] = rowsFor(harness, 'u1')
    expect(row.last_burn_prewarn_alert_at).toBe(NOW_ISO)
    // A shared column would let the repeat cadence and this warning suppress each other.
    expect(row.last_full_alert_at).toBeUndefined()
  })

  it('sends the pre-quiet warning before the window opens', async () => {
    const harness = install(
      makeDb({
        prefRows: [
          prefs('u1', {
            alert_on_full: false,
            alert_before_quiet_hours: true,
            alert_before_quiet_hours_minutes: 60,
            quiet_hours_start: 9,
            quiet_hours_end: 17,
            quiet_hours_timezone: EDT_ZONE
          })
        ],
        mappingRows: [mapping('u1')],
        stateRows: [
          state('u1', {
            last_tokens: 3,
            capped_since: '2026-07-18T10:00:00.000Z'
          })
        ],
        rpcByGuild: { GUILD_A: { data: [fullRpcRow('u1')], error: null } }
      })
    )

    const summary = await runUserTokenAlertScan()

    expect(summary.byType.pre_quiet).toBe(1)
    expect(sendDmMock.mock.calls[0][0].content).toContain(
      'Quiet hours start in about 1h'
    )
    expect(sendDmMock.mock.calls[0][0].content).toContain('FULL (3/3)')

    const [row] = rowsFor(harness, 'u1')
    expect(row.last_pre_quiet_alert_at).toBe(NOW_ISO)
  })
})

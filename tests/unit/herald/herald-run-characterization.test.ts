/** Characterization of `runHeraldForSync`: behaviour is asserted as-is. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runHeraldForSync, type HeraldBattle } from '@/app/lib/herald/engine'
import { postToWebhook } from '@/app/lib/discord/webhook-service'
import {
  ensureRotationSnapshot,
  type SeasonRotationSnapshot
} from '@/app/lib/loki/rotation-cache'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'

vi.mock('@/app/lib/discord/webhook-service', () => ({
  postToWebhook: vi.fn(async () => ({
    ok: true,
    status: 204,
    attempts: 1
  })),
  logDiscordWebhookDelivery: vi.fn(async () => undefined)
}))

// Stage-unlock predictor inputs default to null so it contributes nothing.
vi.mock('@/app/lib/loki/rotation-cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureRotationSnapshot: vi.fn(async () => null)
}))
vi.mock(
  '@/app/lib/boss-assignments/progression-config',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getActiveProgressionConfig: vi.fn(async () => null)
  })
)

const NOW_MS = 1_700_000_000_000
const GUILD = 'EOT'
const GUILD_WEBHOOK_URL = 'https://discord.com/api/webhooks/guild/token'
const DISCORD_WEBHOOK_LOG_STATUSES = new Set([
  'pending',
  'delivered',
  'failed',
  'rate_limited'
])

const mainKill = (overrides: Partial<HeraldBattle> = {}): HeraldBattle => ({
  type: 'Ghazghkull',
  encounterIndex: 0,
  completedOn: NOW_MS - 60_000,
  remainingHp: 0,
  rarity: 'Legendary',
  userId: 'u1',
  displayName: 'Roy',
  tier: 5,
  set: 2,
  Season: 42,
  loopIndex: 0,
  ...overrides
})

const primeKill = (
  enc: 1 | 2,
  overrides: Partial<HeraldBattle> = {}
): HeraldBattle => mainKill({ encounterIndex: enc, ...overrides })

const livePrime = (overrides: Partial<HeraldBattle> = {}): HeraldBattle =>
  mainKill({ encounterIndex: 1, remainingHp: 5_000, ...overrides })

const snapshotRow = (bossId: string) => ({
  season: 42,
  boss_id: bossId,
  loop_index: 0,
  rarity: 'Legendary',
  set_num: 2
})

interface MockPayload {
  data: unknown
  error: unknown
}

const makeRunSupabase = (
  opts: {
    guildConfig?: Record<string, unknown> | null
    webhookConfigRows?: Array<Record<string, unknown>>
    bossConfigRows?: Array<Record<string, unknown>>
    availabilitySnapshotRows?: Array<Record<string, unknown>>
    availabilityInsertResult?: MockPayload
    postedEventsInsertResult?: MockPayload
    eotGrDataRows?: Array<Record<string, unknown>>
    availabilityTableThrows?: boolean
    auditInsertError?: string
  } = {}
) => {
  const guildConfig =
    opts.guildConfig === undefined
      ? { notifications_enabled: true }
      : opts.guildConfig
  const webhookConfigRows = opts.webhookConfigRows ?? [
    {
      webhook_url: GUILD_WEBHOOK_URL,
      thread_id: null,
      enabled: true,
      updated_at: '2026-07-30T00:00:00Z'
    }
  ]
  const availabilityInsertResult = opts.availabilityInsertResult ?? {
    data: { id: 811, first_seen_at: '2026-07-30T00:00:00Z' },
    error: null
  }
  const postedEventsInsertResult = opts.postedEventsInsertResult ?? {
    data: { id: 501 },
    error: null
  }

  const inserts: Record<string, Array<Record<string, unknown>>> = {}
  const deletes: Array<{ table: string; column: string; value: unknown }> = []
  const tablesQueried: string[] = []
  let auditErrorReadCount = 0

  const makeQuery = (
    table: string,
    listPayload: MockPayload,
    maybeSinglePayload: MockPayload
  ) => {
    let awaitPayload = listPayload
    const proxy: Record<string, unknown> = {}
    const identity = () => proxy
    proxy.select = identity
    proxy.eq = identity
    proxy.in = identity
    proxy.or = identity
    proxy.order = identity
    proxy.limit = identity
    proxy.update = vi.fn(() => proxy)
    proxy.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === 'discord_webhook_logs') {
        const status = typeof row.status === 'string' ? row.status : ''
        const errorMessage =
          opts.auditInsertError ??
          (DISCORD_WEBHOOK_LOG_STATUSES.has(status)
            ? null
            : `discord_webhook_logs_status_check rejected ${status}`)
        if (errorMessage) {
          awaitPayload = {
            data: null,
            get error() {
              auditErrorReadCount += 1
              return { message: errorMessage }
            }
          }
          return proxy
        }
        awaitPayload = { data: null, error: null }
      }
      inserts[table] = [...(inserts[table] ?? []), row]
      return proxy
    })
    proxy.delete = vi.fn(() => ({
      eq: vi.fn((column: string, value: unknown) => {
        deletes.push({ table, column, value })
        return Promise.resolve({ error: null })
      })
    }))
    proxy.maybeSingle = vi.fn(() => Promise.resolve(maybeSinglePayload))
    proxy.then = (
      resolve: (value: MockPayload) => unknown,
      reject: (reason?: unknown) => unknown
    ) => Promise.resolve(awaitPayload).then(resolve, reject)
    return proxy
  }

  const emptyList: MockPayload = { data: [], error: null }
  const nullSingle: MockPayload = { data: null, error: null }

  const fromMock = vi.fn((table: string) => {
    tablesQueried.push(table)
    switch (table) {
      case 'guild_config':
        return makeQuery(
          table,
          { data: guildConfig, error: null },
          { data: guildConfig, error: null }
        )
      case 'webhook_config':
        return makeQuery(
          table,
          { data: webhookConfigRows, error: null },
          {
            data: webhookConfigRows[0] ?? null,
            error: null
          }
        )
      case 'clusters':
        return makeQuery(table, nullSingle, nullSingle)
      case 'herald_boss_config':
        return makeQuery(
          table,
          { data: opts.bossConfigRows ?? [], error: null },
          nullSingle
        )
      case 'herald_meta_role_mapping':
      case 'boss_mapping':
      case 'upcoming_season_bosses':
      case 'boss_target_tokens':
        return makeQuery(table, emptyList, nullSingle)
      case 'EOT_GR_data':
        return makeQuery(
          table,
          { data: opts.eotGrDataRows ?? [], error: null },
          nullSingle
        )
      case 'herald_boss_availability':
        if (opts.availabilityTableThrows) {
          throw new Error('boom: herald_boss_availability unavailable')
        }
        return makeQuery(
          table,
          { data: opts.availabilitySnapshotRows ?? [], error: null },
          availabilityInsertResult
        )
      case 'herald_posted_events':
        return makeQuery(table, nullSingle, postedEventsInsertResult)
      case 'discord_webhook_logs':
        return makeQuery(table, nullSingle, nullSingle)
      default:
        throw new Error(`unexpected table: ${table}`)
    }
  })

  return {
    inserts,
    deletes,
    tablesQueried,
    auditErrorReads: () => auditErrorReadCount,
    supabase: { from: fromMock } as unknown as Parameters<
      typeof runHeraldForSync
    >[0]['supabase']
  }
}

const postMock = vi.mocked(postToWebhook)

const sentPayload = (callIndex: number) =>
  postMock.mock.calls[callIndex][1] as {
    content?: string
    embeds?: unknown[]
    allowed_mentions?: { parse?: string[]; roles?: string[] }
  }

beforeEach(() => {
  postMock.mockClear()
})

describe('runHeraldForSync — no-op sync', () => {
  it('returns an all-zero result and still runs auto-update, without loading guild config', async () => {
    const { supabase, tablesQueried } = makeRunSupabase()
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      nowMs: NOW_MS
    })
    expect(typeof result.invocation_id).toBe('string')
    expect(result).toMatchObject({
      detected: 0,
      posted: 0,
      deduped: 0,
      failed: 0,
      availability_detected: 0,
      availability_posted: 0,
      availability_deduped: 0,
      availability_failed: 0
    })
    expect(result.skipped_reason).toBeNull()
    expect(tablesQueried).toContain('herald_meta_role_mapping')
    expect(tablesQueried).not.toContain('guild_config')
    expect(tablesQueried).not.toContain('webhook_config')
    expect(postMock).not.toHaveBeenCalled()
  })
})

describe('runHeraldForSync — defeat-dispatch phase (~:5774–5939)', () => {
  it('happy path: kill row → defeat detected → dedup row claimed → webhook fired → posted=1', async () => {
    const { supabase, inserts, deletes } = makeRunSupabase()
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(1)
    expect(result.posted).toBe(1)
    expect(result.deduped).toBe(0)
    expect(result.failed).toBe(0)
    expect(inserts.herald_posted_events).toHaveLength(1)
    expect(inserts.herald_posted_events[0]).toMatchObject({
      guild_code: GUILD,
      season: 42,
      boss_id: 'Ghazghkull_E0',
      transition_type: 'boss_defeated',
      completed_on: NOW_MS - 60_000
    })
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0][0]).toBe(GUILD_WEBHOOK_URL)
    const payload = postMock.mock.calls[0][1] as {
      embeds?: unknown[]
      allowed_mentions?: unknown
    }
    expect(payload.embeds).toHaveLength(1)
    expect(payload.allowed_mentions).toEqual({ parse: [] })
    expect(deletes).toHaveLength(0)
  })

  it('dedup: 23505 on the herald_posted_events claim increments deduped and does not post', async () => {
    const { supabase } = makeRunSupabase({
      postedEventsInsertResult: {
        data: null,
        error: { code: '23505', message: 'duplicate key value' }
      }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(1)
    expect(result.deduped).toBe(1)
    expect(result.posted).toBe(0)
    expect(result.failed).toBe(0)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('dedup: a null-row claim insert (data null, error null) also counts as deduped', async () => {
    // Characterization: a claim INSERT returning no row is treated like a 23505 collision.
    const { supabase } = makeRunSupabase({
      postedEventsInsertResult: { data: null, error: null }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })
    expect(result.deduped).toBe(1)
    expect(result.posted).toBe(0)
    expect(result.failed).toBe(0)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('claim-DELETE rollback: total fanout failure deletes the claimed dedup row and counts failed', async () => {
    const { supabase, deletes } = makeRunSupabase()
    postMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      attempts: 3,
      error: { type: 'server_error', message: 'Discord 500' }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })
    expect(result.failed).toBe(1)
    expect(result.posted).toBe(0)
    expect(deletes).toEqual([
      { table: 'herald_posted_events', column: 'id', value: 501 }
    ])
  })

  it('prime-combining: combine_prime_deaths collapses E1+E2 into one post and pre-claims the consumed prime', async () => {
    const { supabase, inserts } = makeRunSupabase({
      guildConfig: { notifications_enabled: true, combine_prime_deaths: true }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [
        primeKill(1, { completedOn: NOW_MS - 120_000 }),
        primeKill(2, { completedOn: NOW_MS - 90_000 })
      ],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(2)
    expect(result.posted).toBe(1)
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(inserts.herald_posted_events).toHaveLength(2)
    expect(inserts.herald_posted_events[0]).toMatchObject({
      boss_id: 'Ghazghkull_E2',
      transition_type: 'boss_defeated',
      completed_on: NOW_MS - 90_000
    })
    expect(inserts.herald_posted_events[1]).toMatchObject({
      boss_id: 'Ghazghkull_E1',
      transition_type: 'boss_defeated',
      completed_on: NOW_MS - 120_000
    })
  })

  it('defeat_alerts_enabled=false suppresses dispatch without claiming a dedup row', async () => {
    const { supabase, inserts } = makeRunSupabase({
      guildConfig: { notifications_enabled: true, defeat_alerts_enabled: false }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(1)
    expect(result.posted).toBe(0)
    expect(result.deduped).toBe(0)
    expect(result.failed).toBe(0)
    expect(inserts.herald_posted_events ?? []).toHaveLength(0)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('master toggle off: dispatch is suppressed-and-logged, and NO result counter is incremented', async () => {
    const { supabase, inserts } = makeRunSupabase({
      guildConfig: { notifications_enabled: false }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(1)
    expect(result.posted).toBe(0)
    expect(result.deduped).toBe(0)
    expect(result.failed).toBe(0)
    // No dedup claim, so re-enabling the toggle can re-fire later…
    expect(inserts.herald_posted_events ?? []).toHaveLength(0)
    // …but a suppression audit row lands, with CHECK-valid status `pending`.
    expect(inserts.discord_webhook_logs).toHaveLength(1)
    expect(inserts.discord_webhook_logs[0]).toMatchObject({
      guild_code: GUILD,
      status: 'pending',
      suppressed_by_master_toggle: true
    })
    expect(postMock).not.toHaveBeenCalled()
  })

  it('master-toggle audit reads a returned insert error without changing dispatch outcome', async () => {
    const { supabase, inserts, auditErrorReads } = makeRunSupabase({
      guildConfig: { notifications_enabled: false },
      auditInsertError: 'permission denied'
    })

    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })

    expect(result).toMatchObject({ posted: 0, failed: 0 })
    expect(inserts.discord_webhook_logs).toBeUndefined()
    expect(auditErrorReads()).toBe(1)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('no webhook and no per-boss config: returns skipped_reason no_enabled_webhook without posting', async () => {
    const { supabase, inserts } = makeRunSupabase({ webhookConfigRows: [] })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(1)
    expect(result.posted).toBe(0)
    expect(result.skipped_reason).toBe('no_enabled_webhook')
    expect(inserts.herald_posted_events ?? []).toHaveLength(0)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('kills arriving only via allBattles still drive defeat detection (battles param is superseded)', async () => {
    // When allBattles is non-empty it replaces `battles` for defeat detection.
    const { supabase } = makeRunSupabase({
      availabilitySnapshotRows: [
        snapshotRow('Ghazghkull_E1'),
        snapshotRow('Ghazghkull_E2')
      ]
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      allBattles: [primeKill(1)],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(1)
    expect(result.posted).toBe(1)
    expect(result.availability_detected).toBe(0)
    expect(postMock).toHaveBeenCalledTimes(1)
  })
})

describe('runHeraldForSync — availability-dispatch phase (~:5940–6260)', () => {
  it('happy path: living prime row → snapshot claim insert → audit row → webhook fired', async () => {
    const { supabase, inserts, deletes } = makeRunSupabase({
      availabilitySnapshotRows: [snapshotRow('Ghazghkull_E2')]
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      allBattles: [livePrime()],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(0)
    expect(result.availability_detected).toBe(1)
    expect(result.availability_posted).toBe(1)
    expect(result.availability_deduped).toBe(0)
    expect(result.availability_failed).toBe(0)
    expect(inserts.herald_boss_availability).toHaveLength(1)
    expect(inserts.herald_boss_availability[0]).toMatchObject({
      guild_code: GUILD,
      season: 42,
      boss_id: 'Ghazghkull_E1',
      boss_type: 'Ghazghkull',
      encounter_index: 1,
      rarity: 'Legendary',
      tier: 5,
      set_num: 2,
      loop_index: 0
    })
    expect(inserts.herald_posted_events).toHaveLength(1)
    expect(inserts.herald_posted_events[0]).toMatchObject({
      guild_code: GUILD,
      boss_id: 'Ghazghkull_E1',
      transition_type: 'boss_available',
      completed_on: null
    })
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0][0]).toBe(GUILD_WEBHOOK_URL)
    const payload = sentPayload(0)
    expect(payload.embeds).toHaveLength(1)
    expect(payload.content).toBe('🎖️ Ghazghkull is now available!')
    expect(payload.allowed_mentions).toEqual({ parse: [] })
    expect(deletes).toHaveLength(0)
  })

  it('herald_default_role_id fallback: with no per-boss or mapping roles, the guild default role is pinged', async () => {
    const { supabase } = makeRunSupabase({
      guildConfig: {
        notifications_enabled: true,
        herald_default_role_id: '111111111111111111'
      },
      availabilitySnapshotRows: [snapshotRow('Ghazghkull_E2')]
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      allBattles: [livePrime()],
      nowMs: NOW_MS
    })
    expect(result.availability_posted).toBe(1)
    expect(postMock).toHaveBeenCalledTimes(1)
    const payload = sentPayload(0)
    expect(payload.embeds).toHaveLength(1)
    expect(payload.allowed_mentions).toEqual({
      roles: ['111111111111111111']
    })
    expect(payload.content).toBe(
      '🎖️ Ghazghkull is now available!\n<@&111111111111111111>'
    )
  })

  it('dedup: 23505 on the snapshot claim increments availability_deduped and skips audit + webhook', async () => {
    const { supabase, inserts } = makeRunSupabase({
      availabilitySnapshotRows: [snapshotRow('Ghazghkull_E2')],
      availabilityInsertResult: {
        data: null,
        error: { code: '23505', message: 'duplicate key value' }
      }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      allBattles: [livePrime()],
      nowMs: NOW_MS
    })
    expect(result.availability_detected).toBe(1)
    expect(result.availability_deduped).toBe(1)
    expect(result.availability_posted).toBe(0)
    expect(inserts.herald_posted_events ?? []).toHaveLength(0)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('dedup: a null-row snapshot claim (data null, error null) also counts as availability_deduped', async () => {
    const { supabase, inserts } = makeRunSupabase({
      availabilitySnapshotRows: [snapshotRow('Ghazghkull_E2')],
      availabilityInsertResult: { data: null, error: null }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      allBattles: [livePrime()],
      nowMs: NOW_MS
    })
    expect(result.availability_deduped).toBe(1)
    expect(result.availability_posted).toBe(0)
    expect(inserts.herald_posted_events ?? []).toHaveLength(0)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('snapshot diffing: bosses already in herald_boss_availability are not even detected', async () => {
    // Snapshot-diff suppression happens at detection, so availability_detected is 0.
    const { supabase, inserts } = makeRunSupabase({
      availabilitySnapshotRows: [
        snapshotRow('Ghazghkull_E1'),
        snapshotRow('Ghazghkull_E2')
      ]
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      allBattles: [livePrime()],
      nowMs: NOW_MS
    })
    expect(result.availability_detected).toBe(0)
    expect(result.availability_deduped).toBe(0)
    expect(result.availability_posted).toBe(0)
    expect(inserts.herald_boss_availability ?? []).toHaveLength(0)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('claim-DELETE rollback: total fanout failure deletes the snapshot claim but keeps the audit row', async () => {
    const { supabase, inserts, deletes } = makeRunSupabase({
      availabilitySnapshotRows: [snapshotRow('Ghazghkull_E2')]
    })
    postMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      attempts: 3,
      error: { type: 'server_error', message: 'Discord 500' }
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      allBattles: [livePrime()],
      nowMs: NOW_MS
    })
    expect(result.availability_failed).toBe(1)
    expect(result.availability_posted).toBe(0)
    const payload = sentPayload(0)
    expect(payload.embeds).toHaveLength(1)
    expect(payload.content).toBe('🎖️ Ghazghkull is now available!')
    expect(payload.allowed_mentions).toEqual({ parse: [] })
    expect(deletes).toEqual([
      { table: 'herald_boss_availability', column: 'id', value: 811 }
    ])
    // …while the audit row is intentionally left in place (characterization).
    expect(inserts.herald_posted_events).toHaveLength(1)
    expect(inserts.herald_posted_events[0]).toMatchObject({
      transition_type: 'boss_available'
    })
  })

  it('primes-cleared predictor: a prime defeat with all primes dead in EOT_GR_data posts the MAIN boss availability', async () => {
    const { supabase, inserts } = makeRunSupabase({
      eotGrDataRows: [{ encounterIndex: 1 }, { encounterIndex: 2 }]
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [primeKill(1)],
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(1)
    expect(result.posted).toBe(1)
    expect(result.availability_detected).toBe(1)
    expect(result.availability_posted).toBe(1)
    expect(inserts.herald_boss_availability).toHaveLength(1)
    expect(inserts.herald_boss_availability[0]).toMatchObject({
      boss_id: 'Ghazghkull_E0',
      boss_type: 'Ghazghkull',
      encounter_index: 0,
      season: 42,
      loop_index: 0,
      rarity: 'Legendary',
      set_num: 2
    })
    expect(postMock).toHaveBeenCalledTimes(2)
    const payload = sentPayload(1)
    expect(payload.embeds).toHaveLength(1)
    expect(payload.content).toBe('🎖️ Ghazghkull is now available!')
    expect(payload.allowed_mentions).toEqual({ parse: [] })
  }, 10_000) // The orchestrator sleeps 1s between the defeat and availability batches.

  it('availability combine: paired primes collapse to one post, pre-claim the partner, and union both roles', async () => {
    const { supabase, inserts } = makeRunSupabase({
      guildConfig: { notifications_enabled: true, combine_prime_deaths: true },
      bossConfigRows: [
        {
          boss_id: 'Ghazghkull_E1',
          enabled: true,
          discord_role_ids: ['222222222222222222']
        },
        {
          boss_id: 'Ghazghkull_E2',
          enabled: true,
          discord_role_ids: ['333333333333333333']
        }
      ]
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [],
      allBattles: [livePrime()],
      nowMs: NOW_MS
    })
    // Only the primary is dispatched; the consumed partner appears in no counter.
    expect(result.availability_detected).toBe(2)
    expect(result.availability_posted).toBe(1)
    expect(result.availability_deduped).toBe(0)
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(inserts.herald_boss_availability).toHaveLength(2)
    expect(inserts.herald_boss_availability[0]).toMatchObject({
      guild_code: GUILD,
      boss_id: 'Ghazghkull_E2',
      encounter_index: 2,
      season: 42,
      set_num: 2,
      loop_index: 0
    })
    expect(inserts.herald_boss_availability[1]).toMatchObject({
      guild_code: GUILD,
      boss_id: 'Ghazghkull_E1',
      encounter_index: 1,
      season: 42,
      set_num: 2,
      loop_index: 0
    })
    const payload = sentPayload(0)
    expect(payload.embeds).toHaveLength(1)
    expect(payload.allowed_mentions).toEqual({
      roles: ['222222222222222222', '333333333333333333']
    })
    // Names are identical placeholders because boss_mapping is empty.
    expect(payload.content).toBe(
      '🎖️ Ghazghkull & Ghazghkull is now available!\n' +
        '<@&222222222222222222> <@&333333333333333333>'
    )
  })

  it('stage-unlock predictor: a main-boss defeat with a live rotation snapshot emits the NEXT stage primes', async () => {
    const rotationStub: SeasonRotationSnapshot = {
      resolvedAt: '2026-07-30T00:00:00Z',
      seasonNumber: 42,
      source: 'test',
      currentConfigId: 'cfg-a',
      nextConfigId: 'cfg-b',
      currentBosses: [
        {
          boss_type: 'Magnus',
          boss_name: 'Magnus the Red',
          set: 3,
          encounter_id: 0,
          rarity: 'Legendary',
          canonical: 'magnus'
        },
        {
          boss_type: 'Thaumacus',
          boss_name: 'Thaumacus',
          set: 3,
          encounter_id: 1,
          rarity: 'Legendary',
          canonical: 'magnus'
        },
        {
          boss_type: 'Calcuminus',
          boss_name: 'Calcuminus',
          set: 3,
          encounter_id: 2,
          rarity: 'Legendary',
          canonical: 'magnus'
        }
      ],
      nextBosses: [],
      matches: 3,
      observedBosses: [],
      notes: null,
      errorReason: null
    }
    const progressionStub: ProgressionConfig = {
      firstPassSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2'],
      loopSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2'],
      loopStartStage: 'L1',
      gameVersion: 'test'
    }
    vi.mocked(ensureRotationSnapshot).mockResolvedValueOnce(rotationStub)
    vi.mocked(getActiveProgressionConfig).mockResolvedValueOnce(progressionStub)

    const { supabase, inserts } = makeRunSupabase()
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()], // set=2 → stage L3, loop 0
      nowMs: NOW_MS
    })
    expect(result.detected).toBe(1)
    expect(result.posted).toBe(1)
    // Primes are keyed on the L4 main's boss_type, not their own.
    expect(result.availability_detected).toBe(2)
    expect(result.availability_posted).toBe(2)
    expect(inserts.herald_boss_availability).toHaveLength(2)
    expect(inserts.herald_boss_availability[0]).toMatchObject({
      boss_id: 'Magnus_E1',
      boss_type: 'Magnus',
      encounter_index: 1,
      rarity: 'Legendary',
      set_num: 3,
      season: 42,
      loop_index: 0,
      tier: 5
    })
    expect(inserts.herald_boss_availability[1]).toMatchObject({
      boss_id: 'Magnus_E2',
      boss_type: 'Magnus',
      encounter_index: 2,
      rarity: 'Legendary',
      set_num: 3,
      season: 42,
      loop_index: 0,
      tier: 5
    })
    expect(postMock).toHaveBeenCalledTimes(3)
    for (const callIndex of [1, 2]) {
      const payload = sentPayload(callIndex)
      expect(payload.embeds).toHaveLength(1)
      expect(payload.content).toBe('🎖️ Magnus is now available!')
      expect(payload.allowed_mentions).toEqual({ parse: [] })
    }
  }, 15_000) // posts. // 1s defeat→availability batch gap + 1s between the two availability
})

describe('runHeraldForSync — exception safety', () => {
  it('a thrown DB error yields skipped_reason=exception and preserves already-mutated counters', async () => {
    const { supabase } = makeRunSupabase({ availabilityTableThrows: true })
    const result = await runHeraldForSync({
      supabase,
      guildCode: GUILD,
      battles: [mainKill()],
      nowMs: NOW_MS
    })
    expect(result.skipped_reason).toBe('exception')
    // baseResult is mutated in place, so the exception result carries partial counts.
    expect(result.detected).toBe(1)
    expect(result.posted).toBe(0)
    expect(postMock).not.toHaveBeenCalled()
  })
})

/** Characterization: change assertions only for intentional behaviour changes. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import {
  postHeraldManualOverride,
  MANUAL_OVERRIDE_AUDIT_ROLE,
  type ManualOverrideParams
} from '@/app/lib/herald/engine'
import { postToWebhook } from '@/app/lib/discord/webhook-service'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import type { MemberLabelMap } from '@/app/lib/member-labels'

vi.mock('@/app/lib/discord/webhook-service', () => ({
  postToWebhook: vi.fn(async () => ({
    ok: true,
    status: 204,
    attempts: 1
  })),
  logDiscordWebhookDelivery: vi.fn(async () => undefined)
}))

vi.mock('@/app/lib/member-labels-server', () => ({
  getMemberLabelMap: vi.fn(async () => new Map() as MemberLabelMap),
  labelForMember: vi.fn(async (n: string) => n)
}))

const GUILD = 'EOT'
const GUILD_WEBHOOK_URL = 'https://discord.com/api/webhooks/guild/token'
const BOSS_WEBHOOK_A = 'https://discord.com/api/webhooks/bossA/token'
const BOSS_WEBHOOK_B = 'https://discord.com/api/webhooks/bossB/token'
const ROLE_ID = '123456789012345678'
const INVOCATION = 'inv-0001'
const DISCORD_WEBHOOK_LOG_STATUSES = new Set([
  'pending',
  'delivered',
  'failed',
  'rate_limited'
])

interface MockPayload {
  data: unknown
  error: unknown
}

/** `webhook_config` is read both as a `.limit(1)` guild default and as an `.in('id', ids)` list. */
const makeOverrideSupabase = (
  opts: {
    guildWebhookRows?: Array<Record<string, unknown>>
    bossWebhookRows?: Array<Record<string, unknown>>
    guildConfigRow?: Record<string, unknown> | null
    bossConfigRows?: Array<Record<string, unknown>>
    roleMappingRows?: Array<Record<string, unknown>>
    bossMappingRows?: Array<Record<string, unknown>>
    auditTableThrows?: boolean
    auditInsertError?: string
  } = {}
) => {
  const guildWebhookRows = opts.guildWebhookRows ?? [
    {
      webhook_url: GUILD_WEBHOOK_URL,
      thread_id: null,
      enabled: true,
      updated_at: '2026-07-30T00:00:00Z'
    }
  ]
  const guildConfigRow =
    opts.guildConfigRow === undefined
      ? { notifications_enabled: true }
      : opts.guildConfigRow
  const bossMappingRows = opts.bossMappingRows ?? [
    { boss_type: 'Magnus', encounter_index: 1, boss_name: 'Thaumacus' },
    { boss_type: 'Magnus', encounter_index: 2, boss_name: 'Amon' }
  ]

  const inserts: Record<string, Array<Record<string, unknown>>> = {}
  const tablesQueried: string[] = []
  let auditErrorReadCount = 0

  const makeQuery = (
    table: string,
    listPayload: MockPayload,
    maybeSinglePayload: MockPayload,
    listPayloadWhenIn?: MockPayload
  ) => {
    let usedIn = false
    let awaitPayload = listPayload
    const proxy: Record<string, unknown> = {}
    const identity = () => proxy
    proxy.select = identity
    proxy.eq = identity
    proxy.or = identity
    proxy.order = identity
    proxy.limit = identity
    proxy.in = () => {
      usedIn = true
      return proxy
    }
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
    proxy.maybeSingle = vi.fn(() => Promise.resolve(maybeSinglePayload))
    proxy.then = (
      resolve: (value: MockPayload) => unknown,
      reject: (reason?: unknown) => unknown
    ) =>
      Promise.resolve(
        usedIn && listPayloadWhenIn ? listPayloadWhenIn : awaitPayload
      ).then(resolve, reject)
    return proxy
  }

  const emptyList: MockPayload = { data: [], error: null }
  const nullSingle: MockPayload = { data: null, error: null }

  const fromMock = vi.fn((table: string) => {
    tablesQueried.push(table)
    switch (table) {
      case 'webhook_config':
        return makeQuery(
          table,
          { data: guildWebhookRows, error: null },
          nullSingle,
          { data: opts.bossWebhookRows ?? [], error: null }
        )
      case 'guild_config':
        return makeQuery(
          table,
          { data: guildConfigRow, error: null },
          { data: guildConfigRow, error: null }
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
        return makeQuery(
          table,
          { data: opts.roleMappingRows ?? [], error: null },
          nullSingle
        )
      case 'boss_mapping':
        return makeQuery(
          table,
          { data: bossMappingRows, error: null },
          nullSingle
        )
      case 'boss_playbook_replays':
        return makeQuery(table, emptyList, nullSingle)
      case 'discord_webhook_logs':
        if (opts.auditTableThrows) {
          throw new Error('boom: discord_webhook_logs unavailable')
        }
        return makeQuery(table, nullSingle, nullSingle)
      default:
        throw new Error(`unexpected table: ${table}`)
    }
  })

  return {
    inserts,
    tablesQueried,
    auditErrorReads: () => auditErrorReadCount,
    supabase: { from: fromMock } as unknown as ManualOverrideParams['supabase']
  }
}

const bossConfigRow = (overrides: Record<string, unknown> = {}) => ({
  boss_id: 'Magnus_E1',
  rarity_set: null,
  enabled: true,
  webhook_config_ids: [],
  discord_role_ids: [ROLE_ID],
  discord_role_labels: {},
  extra_links: [],
  extra_videos: [],
  custom_message_url: null,
  notes: null,
  side1_notes: null,
  side2_notes: null,
  side1_behaviour: 'kill',
  side2_behaviour: 'kill',
  side1_threshold_hp_pct: null,
  side2_threshold_hp_pct: null,
  ping_mode: 'per_side',
  ping_mode_explicit: false,
  ...overrides
})

const baseParams = (
  supabase: ManualOverrideParams['supabase'],
  overrides: Partial<ManualOverrideParams> = {}
): ManualOverrideParams => ({
  supabase,
  guildCode: GUILD,
  mainBossId: 'Magnus_E0',
  mainBossDisplayName: 'Magnus the Red',
  prime: 'a',
  invocationId: INVOCATION,
  actorDisplayName: 'Roy',
  ...overrides
})

const postMock = vi.mocked(postToWebhook)
const labelMapMock = vi.mocked(getMemberLabelMap)

const sentPayload = (callIndex: number) =>
  postMock.mock.calls[callIndex][1] as {
    content?: string
    embeds?: Array<{ title?: string; description?: string; timestamp?: string }>
    allowed_mentions?: { parse?: string[]; roles?: string[] }
  }

const auditRow = (inserts: Record<string, Array<Record<string, unknown>>>) =>
  inserts.discord_webhook_logs?.[0] as
    | (Record<string, unknown> & {
        mentioned_roles?: Array<
          | string
          | {
              role?: string
              prime?: string
              officer?: string | null
              invocation_id?: string
            }
        >
      })
    | undefined

beforeEach(() => {
  postMock.mockClear()
  postMock.mockResolvedValue({ ok: true, status: 204, attempts: 1 })
  labelMapMock.mockClear()
  labelMapMock.mockResolvedValue(new Map() as MemberLabelMap)
})

describe('postHeraldManualOverride — happy path (prime a)', () => {
  it('resolves the prime boss id, posts to the guild-default webhook, and writes the audit marker', async () => {
    const { supabase, inserts } = makeOverrideSupabase({
      bossConfigRows: [bossConfigRow()]
    })

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result).toEqual({
      channels: 1,
      posted: 1,
      failed: 0,
      scope: 'guild',
      role_ping_count: 1,
      prime_boss_id: 'Magnus_E1'
    })
    expect('error' in result).toBe(false)

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0][0]).toBe(GUILD_WEBHOOK_URL)
    expect(postMock.mock.calls[0][2]).toMatchObject({
      guildCode: GUILD,
      webhookType: 'herald',
      threadId: null,
      retries: 2
    })
    expect(typeof postMock.mock.calls[0][2]?.logDelivery).toBe('function')

    const payload = sentPayload(0)
    expect(payload.content).toBe('**[MANUAL OVERRIDE by Roy]**')
    expect(payload.content).not.toContain('TEST POST')
    expect(payload.embeds).toHaveLength(1)
    // Display name comes from boss_mapping, not the caller-supplied main-boss name.
    expect(payload.embeds?.[0]?.title).toBe('💀 Thaumacus has been defeated!')
    expect(payload.embeds?.[0]?.description).toBe('Slain by **Roy**')
    expect(typeof payload.embeds?.[0]?.timestamp).toBe('string')
    // The defeat preview hard-codes `parse: []`; `role_ping_count` counts resolved roles only.
    expect(payload.allowed_mentions).toEqual({ parse: [] })
    expect(payload.content).not.toContain(`<@&${ROLE_ID}>`)

    expect(inserts.discord_webhook_logs).toHaveLength(1)
    const audit = auditRow(inserts)
    expect(audit).toMatchObject({
      guild_code: GUILD,
      webhook_type: 'herald',
      webhook_url_hash: createHash('sha256')
        .update(GUILD_WEBHOOK_URL)
        .digest('hex'),
      status: 'delivered',
      payload_preview: 'Magnus_E1',
      threshold_breach_type: 'prime_a_threshold',
      manual_override: true
    })
    expect(MANUAL_OVERRIDE_AUDIT_ROLE).toBe('__manual_override__')
    expect(audit?.mentioned_roles?.[0]).toEqual({
      role: '__manual_override__',
      prime: 'a',
      officer: 'Roy',
      invocation_id: INVOCATION
    })
    // Storing unsent resolved roles would inflate mentions-received.
    expect(audit?.mentioned_roles).toHaveLength(1)
  })

  it('omits the "by <officer>" clause when actorDisplayName is null, and audits officer: null', async () => {
    const { supabase, inserts } = makeOverrideSupabase()

    const result = await postHeraldManualOverride(
      baseParams(supabase, { actorDisplayName: null })
    )

    expect(result.posted).toBe(1)
    expect(sentPayload(0).content).toBe('**[MANUAL OVERRIDE]**')
    expect(sentPayload(0).embeds?.[0]?.description).toBe(
      'Slain by **Test Killer**'
    )
    expect(auditRow(inserts)?.mentioned_roles?.[0]).toMatchObject({
      officer: null
    })
  })

  it('relabels the officer name for DISPLAY only — the audit row keeps the raw display_name', async () => {
    // The dedup suffix is a join key; the friendly label is presentation-only.
    labelMapMock.mockResolvedValue(
      new Map([
        ['CurrentName (GUILD_A)', 'CurrentName (formerly PreviousName)']
      ]) as MemberLabelMap
    )
    const { supabase, inserts } = makeOverrideSupabase()

    await postHeraldManualOverride(
      baseParams(supabase, { actorDisplayName: 'CurrentName (GUILD_A)' })
    )

    expect(sentPayload(0).content).toBe(
      '**[MANUAL OVERRIDE by CurrentName (formerly PreviousName)]**'
    )
    expect(sentPayload(0).embeds?.[0]?.description).toBe(
      'Slain by **CurrentName (formerly PreviousName)**'
    )
    expect(auditRow(inserts)?.mentioned_roles?.[0]).toMatchObject({
      officer: 'CurrentName (GUILD_A)'
    })
  })
})

describe('postHeraldManualOverride — prime targeting (a vs b)', () => {
  it("prime 'a' targets encounter 1 and prime 'b' targets encounter 2, with distinct display names", async () => {
    const a = makeOverrideSupabase()
    const resultA = await postHeraldManualOverride(
      baseParams(a.supabase, { prime: 'a' })
    )
    expect(resultA.prime_boss_id).toBe('Magnus_E1')
    expect(sentPayload(0).embeds?.[0]?.title).toBe(
      '💀 Thaumacus has been defeated!'
    )
    expect(auditRow(a.inserts)).toMatchObject({
      payload_preview: 'Magnus_E1',
      threshold_breach_type: 'prime_a_threshold'
    })
    expect(auditRow(a.inserts)?.mentioned_roles?.[0]).toMatchObject({
      prime: 'a'
    })

    postMock.mockClear()

    const b = makeOverrideSupabase()
    const resultB = await postHeraldManualOverride(
      baseParams(b.supabase, { prime: 'b' })
    )
    expect(resultB.prime_boss_id).toBe('Magnus_E2')
    expect(sentPayload(0).embeds?.[0]?.title).toBe('💀 Amon has been defeated!')
    expect(auditRow(b.inserts)).toMatchObject({
      payload_preview: 'Magnus_E2',
      threshold_breach_type: 'prime_b_threshold'
    })
    expect(auditRow(b.inserts)?.mentioned_roles?.[0]).toMatchObject({
      prime: 'b'
    })
  })

  it('per-prime role scope filtering follows the synthesized prime_state (encounter 1 vs 2)', async () => {
    const mappings = [
      {
        discord_role_id: '111111111111111111',
        active_boss_ids: null,
        enabled: true,
        meta_team_slug: 'side-a',
        display_label: 'Side A',
        rarity_set: null,
        prime_scope: 'prime_a',
        track_only: false,
        custom_message_only: false
      },
      {
        discord_role_id: '222222222222222222',
        active_boss_ids: null,
        enabled: true,
        meta_team_slug: 'side-b',
        display_label: 'Side B',
        rarity_set: null,
        prime_scope: 'prime_b',
        track_only: false,
        custom_message_only: false
      }
    ]

    const a = makeOverrideSupabase({ roleMappingRows: mappings })
    const resultA = await postHeraldManualOverride(
      baseParams(a.supabase, { prime: 'a' })
    )
    expect(resultA.role_ping_count).toBe(1)
    expect(sentPayload(0).allowed_mentions).toEqual({ parse: [] })
    expect(auditRow(a.inserts)?.mentioned_roles).toHaveLength(1)
    expect(auditRow(a.inserts)?.mentioned_roles).not.toContain(
      '111111111111111111'
    )

    const b = makeOverrideSupabase({ roleMappingRows: mappings })
    const resultB = await postHeraldManualOverride(
      baseParams(b.supabase, { prime: 'b' })
    )
    expect(resultB.role_ping_count).toBe(1)
    expect(sentPayload(1).allowed_mentions).toEqual({ parse: [] })
    expect(auditRow(b.inserts)?.mentioned_roles).toHaveLength(1)
    expect(auditRow(b.inserts)?.mentioned_roles).not.toContain(
      '222222222222222222'
    )
  })

  it('replaces (not appends) an existing encounter suffix on mainBossId', async () => {
    const { supabase } = makeOverrideSupabase()
    const result = await postHeraldManualOverride(
      baseParams(supabase, { mainBossId: 'Magnus_E1', prime: 'b' })
    )
    expect(result.prime_boss_id).toBe('Magnus_E2')
  })

  it('CHARACTERIZATION: a mainBossId with no _E<n> suffix passes through UNCHANGED and still dispatches', async () => {
    // Nothing validates a suffix-less id; only the route guards this mis-target.
    const { supabase, inserts } = makeOverrideSupabase()
    const result = await postHeraldManualOverride(
      baseParams(supabase, { mainBossId: 'Magnus', prime: 'a' })
    )
    expect(result.prime_boss_id).toBe('Magnus')
    expect(result.posted).toBe(1)
    expect(auditRow(inserts)).toMatchObject({ payload_preview: 'Magnus' })
    expect(sentPayload(0).embeds?.[0]?.title).toBe(
      '💀 Magnus the Red has been defeated!'
    )
  })
})

describe('postHeraldManualOverride — no-channel / disabled paths', () => {
  it('no webhook configured: returns no_valid_channels with scope null, posts nothing, writes no audit row', async () => {
    const { supabase, inserts, tablesQueried } = makeOverrideSupabase({
      guildWebhookRows: [],
      bossConfigRows: [bossConfigRow()]
    })

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result).toEqual({
      channels: 0,
      posted: 0,
      failed: 0,
      scope: null,
      role_ping_count: 1,
      prime_boss_id: 'Magnus_E1',
      error: 'no_valid_channels'
    })
    expect(postMock).not.toHaveBeenCalled()
    expect(inserts.discord_webhook_logs).toBeUndefined()
    expect(tablesQueried).not.toContain('discord_webhook_logs')
  })

  it('per-boss config disabled: short-circuits to zero channels even though a guild-default webhook exists', async () => {
    const { supabase, inserts } = makeOverrideSupabase({
      bossConfigRows: [bossConfigRow({ enabled: false })]
    })

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result.channels).toBe(0)
    expect(result.error).toBe('no_valid_channels')
    // `scope` reports webhook resolution, not whether anything was posted.
    expect(result.scope).toBe('guild')
    expect(postMock).not.toHaveBeenCalled()
    expect(inserts.discord_webhook_logs).toBeUndefined()
  })
})

describe('postHeraldManualOverride — failure paths', () => {
  it('webhook POST fails: failed=1, error is post_failed:<message>, and the audit row is still written with status failed', async () => {
    postMock.mockResolvedValue({
      ok: false,
      status: 500,
      attempts: 3,
      error: { type: 'server_error', message: 'Discord 500' }
    })
    const { supabase, inserts } = makeOverrideSupabase({
      bossConfigRows: [bossConfigRow()]
    })

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result).toEqual({
      channels: 1,
      posted: 0,
      failed: 1,
      scope: 'guild',
      role_ping_count: 1,
      prime_boss_id: 'Magnus_E1',
      error: 'post_failed:Discord 500'
    })
    expect(inserts.discord_webhook_logs).toHaveLength(1)
    expect(auditRow(inserts)).toMatchObject({
      status: 'failed',
      manual_override: true,
      payload_preview: 'Magnus_E1'
    })
    expect(result.error).not.toContain('status')
  })

  it('webhook POST fails with no error message: error falls back to status:<code>', async () => {
    postMock.mockResolvedValue({ ok: false, status: 429, attempts: 3 })
    const { supabase } = makeOverrideSupabase()

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result.failed).toBe(1)
    expect(result.error).toBe('post_failed:status:429')
  })

  it('webhook POST throws: the exception is caught, counted as failed, and surfaced in error', async () => {
    postMock.mockRejectedValue(new Error('socket hang up'))
    const { supabase, inserts } = makeOverrideSupabase()

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result.posted).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.error).toBe('post_failed:socket hang up')
    expect(auditRow(inserts)).toMatchObject({ status: 'failed' })
  })

  it('audit write failure is swallowed: the dispatch result is unaffected and nothing throws', async () => {
    const { supabase } = makeOverrideSupabase({ auditTableThrows: true })

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result).toMatchObject({
      channels: 1,
      posted: 1,
      failed: 0,
      prime_boss_id: 'Magnus_E1'
    })
    expect(postMock).toHaveBeenCalledTimes(1)
  })

  it('reads a returned audit insert error while keeping delivery best-effort', async () => {
    const { supabase, inserts, auditErrorReads } = makeOverrideSupabase({
      auditInsertError: 'permission denied'
    })

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result).toMatchObject({ posted: 1, failed: 0 })
    expect(inserts.discord_webhook_logs).toBeUndefined()
    // Write failures resolve in `{ error }`; the writer must read it.
    expect(auditErrorReads()).toBe(1)
  })
})

describe('postHeraldManualOverride — multi-channel fanout', () => {
  it('fans out to every enabled per-boss webhook but hashes only channels[0] into the single audit row', async () => {
    const { supabase, inserts } = makeOverrideSupabase({
      bossConfigRows: [bossConfigRow({ webhook_config_ids: ['wh-a', 'wh-b'] })],
      bossWebhookRows: [
        {
          id: 'wh-a',
          webhook_url: BOSS_WEBHOOK_A,
          thread_id: 'thread-a',
          enabled: true
        },
        {
          id: 'wh-b',
          webhook_url: BOSS_WEBHOOK_B,
          thread_id: null,
          enabled: true
        }
      ]
    })

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result).toMatchObject({ channels: 2, posted: 2, failed: 0 })
    expect(postMock).toHaveBeenCalledTimes(2)
    expect(postMock.mock.calls[0][0]).toBe(BOSS_WEBHOOK_A)
    expect(postMock.mock.calls[0][2]).toMatchObject({ threadId: 'thread-a' })
    expect(postMock.mock.calls[1][0]).toBe(BOSS_WEBHOOK_B)
    expect(postMock.mock.calls[0][1]).toBe(postMock.mock.calls[1][1])
    expect(inserts.discord_webhook_logs).toHaveLength(1)
    expect(auditRow(inserts)).toMatchObject({
      status: 'delivered',
      webhook_url_hash: createHash('sha256')
        .update(BOSS_WEBHOOK_A)
        .digest('hex')
    })
  }, 15000)

  it('partial fanout persists a final failed audit even when a later channel succeeds', async () => {
    postMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        attempts: 3,
        error: { type: 'server_error', message: 'Discord 500' }
      })
      .mockResolvedValueOnce({ ok: true, status: 204, attempts: 1 })
    const { supabase, inserts } = makeOverrideSupabase({
      bossConfigRows: [bossConfigRow({ webhook_config_ids: ['wh-a', 'wh-b'] })],
      bossWebhookRows: [
        {
          id: 'wh-a',
          webhook_url: BOSS_WEBHOOK_A,
          thread_id: null,
          enabled: true
        },
        {
          id: 'wh-b',
          webhook_url: BOSS_WEBHOOK_B,
          thread_id: null,
          enabled: true
        }
      ]
    })

    const result = await postHeraldManualOverride(baseParams(supabase))

    expect(result).toMatchObject({ channels: 2, posted: 1, failed: 1 })
    // `error` is only set when posted === 0; callers must read `failed`.
    expect('error' in result).toBe(false)
    // The aggregate row stays failed so health cannot report recovery while another destination is broken.
    expect(auditRow(inserts)).toMatchObject({
      status: 'failed',
      manual_override: true,
      payload_preview: 'Magnus_E1'
    })
  }, 15000)
})

describe('postHeraldManualOverride — dedup / claim behavior (absence pin)', () => {
  it('has NO dedup or claim: it never touches herald_posted_events or herald_boss_availability', async () => {
    const { supabase, inserts, tablesQueried } = makeOverrideSupabase()

    await postHeraldManualOverride(baseParams(supabase))

    expect(tablesQueried).not.toContain('herald_posted_events')
    expect(tablesQueried).not.toContain('herald_boss_availability')
    expect(Object.keys(inserts)).toEqual(['discord_webhook_logs'])
  })

  it('is fully re-fireable: two identical invocations post twice and audit twice', async () => {
    // No idempotency key: the route's 30s window is the only double-click guard,
    // so both audit rows must persist with a CHECK-valid status.
    const { supabase, inserts } = makeOverrideSupabase()

    await postHeraldManualOverride(baseParams(supabase))
    await postHeraldManualOverride(baseParams(supabase))

    expect(postMock).toHaveBeenCalledTimes(2)
    expect(inserts.discord_webhook_logs).toHaveLength(2)
    expect(auditRow(inserts)?.mentioned_roles?.[0]).toMatchObject({
      invocation_id: INVOCATION
    })
  })
})

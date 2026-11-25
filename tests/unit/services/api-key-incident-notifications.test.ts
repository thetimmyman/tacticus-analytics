import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  loggerWarn: vi.fn(),
  resendSend: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({ serviceDb: mocks.serviceDb }))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn()
  })
}))
vi.mock('resend', () => ({
  Resend: vi.fn(function () {
    return { emails: { send: mocks.resendSend } }
  })
}))

import {
  classifyApiIncident,
  isRecentlyActiveGuild,
  sendApiKeyIncidentNotifications
} from '@/app/lib/services/api-key-incident-notifications'

type TestGuild = {
  guild_code: string
  enabled: boolean
  display_name: string
  api_key_is_valid: boolean
  consecutive_sync_failures: number
  last_successful_sync: string | null
  last_sync_attempt: string | null
  user_id: string | null
  cluster_id?: string | null
}

type TestIncidentState = {
  guild_code: string
  incident_type: 'invalid_api_key' | 'sync_failures' | null
  incident_started_at: string | null
  incident_last_seen_at: string | null
  notified_at: string | null
  notified_recipients: string[] | null
  notified_recipient_count: number | null
  last_notification_error: string | null
  resolved_at: string | null
}

const TEST_NOW = new Date('2026-10-05T12:00:00.000Z')

function makeNotificationClient(
  guildRows: TestGuild[],
  stateRows: TestIncidentState[],
  failingTable?: string,
  extras?: {
    clusters?: Array<{ id: string; created_by: string | null }>
    playerMappings?: Array<{
      guild_code: string
      user_id: string | null
      role: string
      is_current?: boolean
    }>
    authEmails?: Array<{ user_id: string; email: string | null }>
  }
) {
  const upserts: Array<Record<string, unknown>> = []
  const client = {
    from: vi.fn((table: string) => {
      const filters: Array<{ op: string; col: string; val: unknown }> = []
      const builder: Record<string, ReturnType<typeof vi.fn>> = {}
      const applyFilters = <T extends Record<string, unknown>>(rows: T[]) =>
        rows.filter((row) =>
          filters.every((f) => {
            if (f.op === 'eq') return row[f.col] === f.val
            if (f.op === 'neq') return row[f.col] !== f.val
            if (f.op === 'not_null')
              return row[f.col] !== null && row[f.col] !== undefined
            if (f.op === 'in') return (f.val as unknown[]).includes(row[f.col])
            return true
          })
        )
      const resolveRows = () => {
        if (table === failingTable) {
          return { data: null, error: { message: 'synthetic read failure' } }
        }
        if (table === 'guild_api_incident_notification_state') {
          return { data: applyFilters(stateRows), error: null }
        }
        if (table === 'guild_config') {
          return { data: applyFilters(guildRows), error: null }
        }
        if (table === 'clusters') {
          return { data: applyFilters(extras?.clusters ?? []), error: null }
        }
        if (table === 'player_mapping') {
          return {
            data: applyFilters(extras?.playerMappings ?? []),
            error: null
          }
        }
        if (table === 'auth_user_emails') {
          return { data: applyFilters(extras?.authEmails ?? []), error: null }
        }
        return { data: [], error: null }
      }
      builder.select = vi.fn(() => {
        filters.length = 0
        return builder
      })
      builder.eq = vi.fn((col: string, val: unknown) => {
        filters.push({ op: 'eq', col, val })
        return builder
      })
      builder.neq = vi.fn((col: string, val: unknown) => {
        filters.push({ op: 'neq', col, val })
        return builder
      })
      builder.not = vi.fn((col: string, _op: string, _val: unknown) => {
        filters.push({ op: 'not_null', col, val: null })
        return builder
      })
      builder.order = vi.fn(() => builder)
      builder.in = vi.fn((col: string, values: unknown[]) => {
        filters.push({ op: 'in', col, val: values })
        return builder
      })
      builder.range = vi.fn(async (start: number, end: number) => ({
        data: guildRows.slice(start, end + 1),
        error:
          table === failingTable ? { message: 'synthetic read failure' } : null
      }))
      builder.maybeSingle = vi.fn(async () => {
        const res = resolveRows()
        if (res.error) return { data: null, error: res.error }
        return { data: (res.data as unknown[])[0] ?? null, error: null }
      })
      builder.upsert = vi.fn(async (row: Record<string, unknown>) => {
        upserts.push(row)
        return { error: null }
      })
      ;(builder as unknown as PromiseLike<unknown>).then = (resolve, reject) =>
        Promise.resolve(resolveRows()).then(resolve, reject)
      return builder
    })
  }
  return { client, upserts }
}

function incidentState(
  overrides: Partial<TestIncidentState> = {}
): TestIncidentState {
  return {
    guild_code: 'synthetic-guild',
    incident_type: 'invalid_api_key',
    incident_started_at: new Date(
      TEST_NOW.getTime() - 9 * 24 * 60 * 60 * 1000
    ).toISOString(),
    incident_last_seen_at: TEST_NOW.toISOString(),
    notified_at: null,
    notified_recipients: [],
    notified_recipient_count: 0,
    last_notification_error: 'No eligible leadership email recipients found',
    resolved_at: null,
    ...overrides
  }
}

function invalidKeyGuild(): TestGuild {
  return {
    guild_code: 'synthetic-guild',
    enabled: true,
    display_name: 'Synthetic guild',
    api_key_is_valid: false,
    consecutive_sync_failures: 5,
    last_successful_sync: null,
    last_sync_attempt: new Date(
      TEST_NOW.getTime() - 24 * 60 * 60 * 1000
    ).toISOString(),
    user_id: null
  }
}

async function runNoRecipientSweep(
  guildRows: TestGuild[],
  stateRows: TestIncidentState[]
) {
  const { client, upserts } = makeNotificationClient(guildRows, stateRows)
  mocks.serviceDb.mockReturnValue(client)
  const result = await sendApiKeyIncidentNotifications()
  return { result, upserts }
}

describe('api-key incident no-recipient operations rollup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
    vi.stubEnv('RESEND_API_KEY', 'synthetic-test-key')
    vi.stubEnv('API_KEY_ISSUE_NO_RECIPIENT_ESCALATION_DAYS', '7')
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('logs an aggregate warning after the configured age without exposing guild identifiers', async () => {
    const { result, upserts } = await runNoRecipientSweep(
      [invalidKeyGuild()],
      [incidentState()]
    )

    expect(result.skippedNoRecipients).toBe(1)
    expect(result.noRecipientEscalationDays).toBe(7)
    expect(result.staleInvalidKeyIncidentsWithoutRecipients).toBe(1)
    expect(result.oldestStaleInvalidKeyIncidentDays).toBe(9)
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      {
        source: 'api-key-incident-notifications',
        escalationDays: 7,
        incidentCount: 1,
        oldestIncidentDays: 9
      },
      '[api-key-notifications] Invalid API key incidents remain open without eligible recipients'
    )
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(
      'synthetic-guild'
    )
    expect(upserts.at(-1)).toMatchObject({
      incident_type: 'invalid_api_key',
      notified_at: null,
      notified_recipient_count: 0,
      resolved_at: null
    })
  })

  it('does not escalate at the exact threshold boundary', async () => {
    const { result } = await runNoRecipientSweep(
      [invalidKeyGuild()],
      [
        incidentState({
          incident_started_at: new Date(
            TEST_NOW.getTime() - 7 * 24 * 60 * 60 * 1000
          ).toISOString()
        })
      ]
    )

    expect(result.skippedNoRecipients).toBe(1)
    expect(result.staleInvalidKeyIncidentsWithoutRecipients).toBe(0)
    expect(result.oldestStaleInvalidKeyIncidentDays).toBeNull()
    expect(mocks.loggerWarn).not.toHaveBeenCalled()
  })

  it('still detects stale incidents when player email delivery is unavailable', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const { result } = await runNoRecipientSweep(
      [invalidKeyGuild()],
      [incidentState()]
    )

    expect(result.errors).toContain('RESEND_API_KEY is not configured')
    expect(result.staleInvalidKeyIncidentsWithoutRecipients).toBe(1)
    expect(result.oldestStaleInvalidKeyIncidentDays).toBe(9)
  })

  it('keeps an invalid-key incident open after sync activity leaves the email lookback', async () => {
    const startedAt = new Date(
      TEST_NOW.getTime() - 30 * 24 * 60 * 60 * 1000
    ).toISOString()
    const { result, upserts } = await runNoRecipientSweep(
      [{ ...invalidKeyGuild(), last_sync_attempt: startedAt }],
      [incidentState({ incident_started_at: startedAt })]
    )

    expect(result.resolvedGuilds).toBe(0)
    expect(result.staleInvalidKeyIncidentsWithoutRecipients).toBe(1)
    expect(result.oldestStaleInvalidKeyIncidentDays).toBe(30)
    expect(upserts.at(-1)).toMatchObject({
      incident_type: 'invalid_api_key',
      resolved_at: null
    })
  })

  it('does not start a new incident for a dormant guild outside the lookback', async () => {
    const { result, upserts } = await runNoRecipientSweep(
      [{ ...invalidKeyGuild(), last_sync_attempt: '2026-08-01T00:00:00Z' }],
      []
    )
    expect(result.incidentGuilds).toBe(0)
    expect(upserts).toEqual([])
  })

  it('resets disabled incidents so re-enabling does not reuse prior age or notification', async () => {
    const { result, upserts } = await runNoRecipientSweep(
      [{ ...invalidKeyGuild(), enabled: false }],
      [incidentState({ notified_at: '2026-09-01T00:00:00Z' })]
    )
    expect(result.incidentGuilds).toBe(0)
    expect(result.resolvedGuilds).toBe(1)
    const reset = upserts[0] as TestIncidentState
    expect(reset).toMatchObject({
      incident_type: null,
      incident_started_at: null,
      notified_at: null,
      resolved_at: TEST_NOW.toISOString()
    })
    const reenabled = await runNoRecipientSweep([invalidKeyGuild()], [reset])
    expect(reenabled.result.skippedAlreadyNotified).toBe(0)
    expect(reenabled.result.staleInvalidKeyIncidentsWithoutRecipients).toBe(0)
    expect(reenabled.upserts.at(-1)?.incident_started_at).toBe(
      TEST_NOW.toISOString()
    )
  })

  it('finds a stale incident beyond the first guild page', async () => {
    const healthy = Array.from({ length: 150 }, (_, i) => ({
      ...invalidKeyGuild(),
      guild_code: `synthetic-${i}`,
      api_key_is_valid: true,
      consecutive_sync_failures: 0
    }))
    const { result } = await runNoRecipientSweep(
      [...healthy, invalidKeyGuild()],
      [incidentState()]
    )
    expect(result.scannedGuilds).toBe(151)
    expect(result.staleInvalidKeyIncidentsWithoutRecipients).toBe(1)
  })

  it.each([
    'guild_config',
    'guild_api_incident_notification_state',
    'player_mapping'
  ])('rejects an incomplete sweep when %s cannot be read', async (table) => {
    const { client } = makeNotificationClient(
      [invalidKeyGuild()],
      [incidentState()],
      table
    )
    mocks.serviceDb.mockReturnValue(client)
    await expect(sendApiKeyIncidentNotifications()).rejects.toThrow(
      /sweep failed|recipient lookup failed/
    )
  })

  it('does not treat an invalid incident timestamp as stale', async () => {
    const { result } = await runNoRecipientSweep(
      [invalidKeyGuild()],
      [incidentState({ incident_started_at: 'not-a-timestamp' })]
    )

    expect(result.skippedNoRecipients).toBe(1)
    expect(result.staleInvalidKeyIncidentsWithoutRecipients).toBe(0)
    expect(result.oldestStaleInvalidKeyIncidentDays).toBeNull()
    expect(mocks.loggerWarn).not.toHaveBeenCalled()
  })

  it('clears the stale rollup when the incident is no longer active', async () => {
    const healthyGuild = {
      ...invalidKeyGuild(),
      api_key_is_valid: true,
      consecutive_sync_failures: 0,
      last_successful_sync: TEST_NOW.toISOString()
    }
    const { result, upserts } = await runNoRecipientSweep(
      [healthyGuild],
      [incidentState()]
    )

    expect(result.resolvedGuilds).toBe(1)
    expect(result.staleInvalidKeyIncidentsWithoutRecipients).toBe(0)
    expect(result.oldestStaleInvalidKeyIncidentDays).toBeNull()
    expect(mocks.loggerWarn).not.toHaveBeenCalled()
    expect(upserts).toContainEqual(
      expect.objectContaining({
        incident_type: null,
        notified_recipient_count: 0,
        resolved_at: TEST_NOW.toISOString()
      })
    )
  })

  it('falls back to cluster creator email when a cluster guild has no guild-level recipients', async () => {
    mocks.resendSend.mockResolvedValue({ data: { id: 'msg-1' }, error: null })
    const guild = { ...invalidKeyGuild(), cluster_id: 'cluster-1' }
    const { client, upserts } = makeNotificationClient(
      [guild],
      [incidentState()],
      undefined,
      {
        clusters: [{ id: 'cluster-1', created_by: 'cluster-owner-1' }],
        authEmails: [
          { user_id: 'cluster-owner-1', email: 'owner@example.test' }
        ]
      }
    )
    mocks.serviceDb.mockReturnValue(client)

    const result = await sendApiKeyIncidentNotifications()

    expect(result.guildsNotified).toBe(1)
    expect(result.emailsSent).toBe(1)
    expect(result.skippedNoRecipients).toBe(0)
    expect(result.staleInvalidKeyIncidentsWithoutRecipients).toBe(0)
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.test' })
    )
    expect(upserts.at(-1)).toMatchObject({
      notified_recipient_count: 1,
      notified_recipients: ['owner@example.test']
    })
  })

  it('falls back to sibling enabled-guild leaders when cluster creator has no email', async () => {
    mocks.resendSend.mockResolvedValue({ data: { id: 'msg-2' }, error: null })
    const brokenGuild = { ...invalidKeyGuild(), cluster_id: 'cluster-1' }
    const siblingGuild = {
      ...invalidKeyGuild(),
      guild_code: 'synthetic-sibling',
      api_key_is_valid: true,
      consecutive_sync_failures: 0,
      cluster_id: 'cluster-1'
    }
    const { client } = makeNotificationClient(
      [brokenGuild, siblingGuild],
      [incidentState()],
      undefined,
      {
        clusters: [{ id: 'cluster-1', created_by: null }],
        playerMappings: [
          {
            guild_code: 'synthetic-sibling',
            user_id: 'sib-leader-1',
            role: 'leader',
            is_current: true
          },
          {
            guild_code: 'synthetic-sibling',
            user_id: 'sib-officer-1',
            role: 'officer',
            is_current: true
          }
        ],
        authEmails: [
          { user_id: 'sib-leader-1', email: 'leader@example.test' },
          { user_id: 'sib-officer-1', email: 'officer@example.test' }
        ]
      }
    )
    mocks.serviceDb.mockReturnValue(client)

    const result = await sendApiKeyIncidentNotifications()

    expect(result.guildsNotified).toBe(1)
    expect(result.emailsSent).toBe(1)
    expect(result.skippedNoRecipients).toBe(0)
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'leader@example.test' })
    )
  })

  it('does not notify cluster owner when the guild already has a linked leader', async () => {
    mocks.resendSend.mockResolvedValue({ data: { id: 'msg-3' }, error: null })
    const guild = { ...invalidKeyGuild(), cluster_id: 'cluster-1' }
    const { client } = makeNotificationClient(
      [guild],
      [incidentState()],
      undefined,
      {
        clusters: [{ id: 'cluster-1', created_by: 'cluster-owner-1' }],
        playerMappings: [
          {
            guild_code: 'synthetic-guild',
            user_id: 'guild-leader-1',
            role: 'leader',
            is_current: true
          }
        ],
        authEmails: [
          { user_id: 'guild-leader-1', email: 'guild-leader@example.test' },
          { user_id: 'cluster-owner-1', email: 'cluster-owner@example.test' }
        ]
      }
    )
    mocks.serviceDb.mockReturnValue(client)

    const result = await sendApiKeyIncidentNotifications()

    expect(result.guildsNotified).toBe(1)
    expect(result.emailsSent).toBe(1)
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'guild-leader@example.test' })
    )
  })

  it('rejects the sweep when the clusters fallback query fails', async () => {
    const guild = { ...invalidKeyGuild(), cluster_id: 'cluster-1' }
    const { client } = makeNotificationClient(
      [guild],
      [incidentState()],
      'clusters'
    )
    mocks.serviceDb.mockReturnValue(client)

    await expect(sendApiKeyIncidentNotifications()).rejects.toThrow(
      /recipient lookup failed/
    )
  })
})

describe('api-key-incident-notifications helpers', () => {
  describe('classifyApiIncident', () => {
    it('prioritizes invalid_api_key over failure count', () => {
      const incident = classifyApiIncident({
        api_key_is_valid: false,
        consecutive_sync_failures: 7
      })

      expect(incident?.type).toBe('invalid_api_key')
      expect(incident?.failureCount).toBe(7)
    })

    it('returns sync_failures when failures reach threshold', () => {
      const incident = classifyApiIncident({
        api_key_is_valid: true,
        consecutive_sync_failures: 3
      })

      expect(incident?.type).toBe('sync_failures')
      expect(incident?.failureCount).toBe(3)
    })

    it('returns null when guild is healthy', () => {
      const incident = classifyApiIncident({
        api_key_is_valid: true,
        consecutive_sync_failures: 1
      })

      expect(incident).toBeNull()
    })
  })

  describe('isRecentlyActiveGuild', () => {
    const now = new Date('2026-02-12T00:00:00.000Z')

    it('returns true when last_successful_sync is within lookback', () => {
      const isRecent = isRecentlyActiveGuild(
        {
          last_successful_sync: '2026-02-08T12:00:00.000Z',
          last_sync_attempt: null
        },
        now,
        14
      )

      expect(isRecent).toBe(true)
    })

    it('returns true when last_sync_attempt is within lookback', () => {
      const isRecent = isRecentlyActiveGuild(
        {
          last_successful_sync: null,
          last_sync_attempt: '2026-02-10T09:00:00.000Z'
        },
        now,
        14
      )

      expect(isRecent).toBe(true)
    })

    it('returns false when activity is outside lookback', () => {
      const isRecent = isRecentlyActiveGuild(
        {
          last_successful_sync: '2025-12-01T00:00:00.000Z',
          last_sync_attempt: '2025-12-05T00:00:00.000Z'
        },
        now,
        14
      )

      expect(isRecent).toBe(false)
    })
  })
})

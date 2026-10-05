import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  loggerWarn: vi.fn()
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
vi.mock('resend', () => ({ Resend: vi.fn() }))

import {
  classifyApiIncident,
  isRecentlyActiveGuild,
  sendApiKeyIncidentNotifications
} from '@/app/lib/services/api-key-incident-notifications'

type TestGuild = {
  guild_code: string
  display_name: string
  api_key_is_valid: boolean
  consecutive_sync_failures: number
  last_successful_sync: string | null
  last_sync_attempt: string | null
  user_id: string | null
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
  stateRows: TestIncidentState[]
) {
  const upserts: Array<Record<string, unknown>> = []
  const client = {
    from: vi.fn((table: string) => {
      const builder: Record<string, ReturnType<typeof vi.fn>> = {}
      builder.select = vi.fn(() => builder)
      builder.eq = vi.fn(() => builder)
      builder.not = vi.fn(() => builder)
      builder.in = vi.fn(async () => ({
        data:
          table === 'guild_api_incident_notification_state' ? stateRows : [],
        error: null
      }))
      builder.limit = vi.fn(async () => ({ data: guildRows, error: null }))
      builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
      builder.upsert = vi.fn(async (row: Record<string, unknown>) => {
        upserts.push(row)
        return { error: null }
      })
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

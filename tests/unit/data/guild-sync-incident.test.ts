/** The fake client applies `.eq()` filters, so the query's `enabled = true` filter matters. */
import { describe, it, expect } from 'vitest'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getOpenGuildSyncIncidentForUser } from '@/app/lib/data/guild-sync-incident'

type Row = Record<string, unknown>

const NOW = new Date('2030-01-10T12:00:00.000Z')

function invalidKeyRow(overrides: Row = {}): Row {
  return {
    guild_code: 'GUILD1',
    display_name: 'First Company',
    enabled: true,
    api_key_is_valid: false,
    auto_sync_enabled: true,
    last_successful_sync: '2030-01-08T12:00:00.000Z',
    created_at: '2029-12-01T00:00:00.000Z',
    api_key_last_validated: '2030-01-09T12:00:00.000Z',
    user_id: 'user-owner',
    ...overrides
  }
}

const MAPPING_ROWS: Row[] = [
  {
    user_id: 'user-owner',
    guild_code: 'GUILD1',
    is_current: true,
    display_name: 'Sergeant Key Holder'
  }
]

function makeClient(
  tables: Record<string, Row[]>,
  options?: { error?: string }
): TypedSupabaseClient {
  const client = {
    from(table: string) {
      const rows = tables[table] ?? []
      const filters: Array<[string, unknown]> = []
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value])
          return builder
        },
        maybeSingle: async () => {
          if (options?.error) {
            return { data: null, error: { message: options.error } }
          }
          const matched = rows.filter((row) =>
            filters.every(([column, value]) => row[column] === value)
          )
          return { data: matched[0] ?? null, error: null }
        }
      }
      return builder
    }
  }
  return client as unknown as TypedSupabaseClient
}

const invalidTables = {
  guild_config: [invalidKeyRow()],
  player_mapping: MAPPING_ROWS
}

describe('getOpenGuildSyncIncidentForUser', () => {
  it('returns an invalid_key incident with the owner name and the last sync date', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient(invalidTables),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )

    expect(incident?.reason).toBe('invalid_key')
    expect(incident?.guildCode).toBe('GUILD1')
    expect(incident?.guildDisplayName).toBe('First Company')
    expect(incident?.keyOwnerDisplayName).toBe('Sergeant Key Holder')
    expect(incident?.lastSuccessfulSyncAt).toBe('2030-01-08T12:00:00.000Z')
    expect(incident?.incidentId).toBe(
      'GUILD1:invalid_key:2030-01-08T12:00:00.000Z'
    )
  })

  it('uses last_successful_sync, never api_key_last_validated, for date and incident id', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient({
        guild_config: [
          invalidKeyRow({ api_key_last_validated: '2030-01-09T12:00:00.000Z' })
        ],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )

    expect(incident?.lastSuccessfulSyncAt).toBe('2030-01-08T12:00:00.000Z')
    expect(incident?.incidentId).toBe(
      'GUILD1:invalid_key:2030-01-08T12:00:00.000Z'
    )
  })

  it('keeps the incident id stable when only api_key_last_validated changes', async () => {
    const newer = await getOpenGuildSyncIncidentForUser(
      makeClient({
        guild_config: [
          invalidKeyRow({ api_key_last_validated: '2030-01-10T00:00:00.000Z' })
        ],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )
    const older = await getOpenGuildSyncIncidentForUser(
      makeClient({
        guild_config: [
          invalidKeyRow({ api_key_last_validated: '2030-01-01T00:00:00.000Z' })
        ],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )

    expect(newer?.incidentId).toBe(older?.incidentId)
  })

  it('returns null for a healthy guild', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient({
        guild_config: [
          invalidKeyRow({
            guild_code: 'GUILD2',
            api_key_is_valid: true,
            last_successful_sync: '2030-01-10T11:00:00.000Z'
          })
        ],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD2', role: 'leader' },
      NOW
    )

    expect(incident).toBeNull()
  })

  it('returns null for a disabled guild with an invalid key', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient({
        guild_config: [invalidKeyRow({ enabled: false })],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'leader' },
      NOW
    )

    expect(incident).toBeNull()
  })

  it('returns auto_sync_off with no owner name for a valid key with auto-sync off', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient({
        guild_config: [
          invalidKeyRow({
            api_key_is_valid: true,
            auto_sync_enabled: false
          })
        ],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )

    expect(incident?.reason).toBe('auto_sync_off')
    expect(incident?.keyOwnerDisplayName).toBeNull()
  })

  it('returns stale for a valid, enabled key that has not synced recently', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient({
        guild_config: [
          invalidKeyRow({
            api_key_is_valid: true,
            auto_sync_enabled: true,
            last_successful_sync: '2030-01-08T12:00:00.000Z'
          })
        ],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )

    expect(incident?.reason).toBe('stale')
    expect(incident?.keyOwnerDisplayName).toBeNull()
  })

  it('returns no_key for a guild with no key', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient({
        guild_config: [
          invalidKeyRow({
            api_key_is_valid: null,
            auto_sync_enabled: false,
            user_id: null
          })
        ],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )

    expect(incident?.reason).toBe('no_key')
    expect(incident?.keyOwnerDisplayName).toBeNull()
  })

  it('returns null when the viewer has no guild', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient(invalidTables),
      { guild_code: null, role: 'member' },
      NOW
    )

    expect(incident).toBeNull()
  })

  it('returns null when the query errors', async () => {
    const incident = await getOpenGuildSyncIncidentForUser(
      makeClient(invalidTables, { error: 'boom' }),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )

    expect(incident).toBeNull()
  })

  it('treats leader and officer as leadership and member as not', async () => {
    const leader = await getOpenGuildSyncIncidentForUser(
      makeClient(invalidTables),
      { guild_code: 'GUILD1', role: 'leader' },
      NOW
    )
    const officer = await getOpenGuildSyncIncidentForUser(
      makeClient(invalidTables),
      { guild_code: 'GUILD1', role: 'officer' },
      NOW
    )
    const member = await getOpenGuildSyncIncidentForUser(
      makeClient(invalidTables),
      { guild_code: 'GUILD1', role: 'member' },
      NOW
    )

    expect(leader?.viewerIsLeadership).toBe(true)
    expect(officer?.viewerIsLeadership).toBe(true)
    expect(member?.viewerIsLeadership).toBe(false)
  })
})

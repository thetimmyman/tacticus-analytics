/** The fake client applies `.eq()` filters, so dropping `api_key_is_valid = false` fails. */
import { describe, it, expect } from 'vitest'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getOpenRevokedKeyIncidentForUser } from '@/app/lib/data/revoked-key-incident'

type Row = Record<string, unknown>

const GUILD_ROW_OPEN: Row = {
  guild_code: 'GUILD1',
  display_name: 'First Company',
  enabled: true,
  api_key_is_valid: false,
  api_key_last_validated: '2026-09-01T10:00:00.000Z',
  last_successful_sync: '2026-08-30T10:00:00.000Z',
  user_id: 'user-owner',
  discord_webhook_enabled: false
}

const GUILD_ROW_HEALTHY: Row = {
  ...GUILD_ROW_OPEN,
  guild_code: 'GUILD2',
  display_name: 'Second Company',
  api_key_is_valid: true
}

const MAPPING_ROWS: Row[] = [
  {
    user_id: 'user-owner',
    guild_code: 'GUILD1',
    is_current: true,
    display_name: 'Sergeant Key Holder'
  },
  {
    user_id: 'user-owner',
    guild_code: 'GUILD2',
    is_current: true,
    display_name: 'Other Guild Holder'
  }
]

function makeClient(tables: Record<string, Row[]>): TypedSupabaseClient {
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

const openIncidentTables = {
  guild_config: [GUILD_ROW_OPEN, GUILD_ROW_HEALTHY],
  player_mapping: MAPPING_ROWS
}

describe('getOpenRevokedKeyIncidentForUser', () => {
  it('returns the open incident for the viewer’s own guild', async () => {
    const incident = await getOpenRevokedKeyIncidentForUser(
      makeClient(openIncidentTables),
      { guild_code: 'GUILD1', role: 'member' }
    )

    expect(incident).not.toBeNull()
    expect(incident?.guildCode).toBe('GUILD1')
    expect(incident?.guildDisplayName).toBe('First Company')
    expect(incident?.keyOwnerDisplayName).toBe('Sergeant Key Holder')
    expect(incident?.openedAt).toBe('2026-09-01T10:00:00.000Z')
    expect(incident?.incidentId).toBe('GUILD1:2026-09-01T10:00:00.000Z')
    expect(incident?.viewerIsLeadership).toBe(false)
    expect(incident?.hasDiscordContactChannel).toBe(false)
  })

  it('returns null for a guild whose key is still valid (negative control)', async () => {
    const incident = await getOpenRevokedKeyIncidentForUser(
      makeClient(openIncidentTables),
      { guild_code: 'GUILD2', role: 'leader' }
    )

    expect(incident).toBeNull()
  })

  it('returns null when the viewer has no guild', async () => {
    const incident = await getOpenRevokedKeyIncidentForUser(
      makeClient(openIncidentTables),
      { guild_code: null, role: 'member' }
    )

    expect(incident).toBeNull()
  })

  it('scopes the read to the viewer’s guild, never another guild’s incident', async () => {
    const incident = await getOpenRevokedKeyIncidentForUser(
      makeClient(openIncidentTables),
      { guild_code: 'GUILD9', role: 'leader' }
    )

    expect(incident).toBeNull()
  })

  it('marks officers and leaders as leadership and reports a configured webhook', async () => {
    const incident = await getOpenRevokedKeyIncidentForUser(
      makeClient({
        guild_config: [{ ...GUILD_ROW_OPEN, discord_webhook_enabled: true }],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'Officer' }
    )

    expect(incident?.viewerIsLeadership).toBe(true)
    expect(incident?.hasDiscordContactChannel).toBe(true)
  })

  it('falls back to the last successful sync when the key was never re-validated', async () => {
    const incident = await getOpenRevokedKeyIncidentForUser(
      makeClient({
        guild_config: [{ ...GUILD_ROW_OPEN, api_key_last_validated: null }],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'member' }
    )

    expect(incident?.openedAt).toBe('2026-08-30T10:00:00.000Z')
    expect(incident?.incidentId).toBe('GUILD1:2026-08-30T10:00:00.000Z')
  })

  it('renders without an owner name when the key owner is not on the roster', async () => {
    const incident = await getOpenRevokedKeyIncidentForUser(
      makeClient({
        guild_config: [{ ...GUILD_ROW_OPEN, user_id: null }],
        player_mapping: MAPPING_ROWS
      }),
      { guild_code: 'GUILD1', role: 'member' }
    )

    expect(incident?.keyOwnerDisplayName).toBeNull()
  })
})

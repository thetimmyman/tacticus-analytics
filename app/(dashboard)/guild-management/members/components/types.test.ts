import { describe, expect, it } from 'vitest'

import {
  toBrowserGuildMemberRow,
  type GuildMemberBrowserSafeRpcRow
} from './types'

function makeSafeRow(
  overrides: Partial<GuildMemberBrowserSafeRpcRow> = {}
): GuildMemberBrowserSafeRpcRow {
  return {
    api_key_is_valid: true,
    assignment_notes: null,
    avatar_unit_id: null,
    boss_preferences: null,
    display_name: 'Player One',
    guild_code: 'EOT',
    has_api_key: true,
    is_claimed: true,
    is_current: true,
    last_battle_time: null,
    last_bomb_time: null,
    last_login_at: null,
    last_sync_at: null,
    last_sync_bombs: null,
    last_sync_tokens: null,
    officer_notes: null,
    player_id: 'player-1',
    player_level: null,
    player_notes: null,
    primary_boss: null,
    primary_team: null,
    role: 'member',
    secondary_boss: null,
    secondary_team: null,
    tacticus_username: 'Player One',
    tertiary_team: null,
    timezone: null,
    user_id: '00000000-0000-0000-0000-000000000001',
    ...overrides
  }
}

describe('toBrowserGuildMemberRow', () => {
  it('maps the RPC API-key presence bit to the client contract', () => {
    const result = toBrowserGuildMemberRow(makeSafeRow())

    expect(result.hasApiKey).toBe(true)
    expect(result).not.toHaveProperty('has_api_key')
    expect(result).not.toHaveProperty('discord_user_id')
    expect(result).not.toHaveProperty('tacticus_api_key_encrypted')
  })

  it('does not treat a redacted null presence value as a key', () => {
    expect(
      toBrowserGuildMemberRow(makeSafeRow({ has_api_key: null })).hasApiKey
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import {
  buildAvailabilityDiscordText,
  buildDiscordIdentityMaps
} from '@/app/components/gr-availability/useAvailabilityExport'
import type { PlayerAvailability } from '@/app/components/gr-availability/types'

const player = (
  overrides: Partial<PlayerAvailability>
): PlayerAvailability => ({
  player_id: 'player-1',
  display_name: 'Player One',
  tokens_available: 2,
  bombs_available: 1,
  token_state: 'regenerating',
  data_source: 'live',
  has_api_key: true,
  token_cooldown: '1h 5m',
  bomb_cooldown: null,
  last_sync_at: null,
  battles_with_damage: 4,
  ...overrides
})

describe('GR availability export model', () => {
  it('sanitizes Discord usernames while preserving verified ids', () => {
    expect(
      buildDiscordIdentityMaps([
        {
          display_name: 'Valid',
          discord_username: 'valid-user',
          discord_user_id: '123'
        },
        { display_name: 'Email', discord_username: 'user@example.com' },
        { display_name: 'Snowflake', discord_username: '123456' }
      ])
    ).toEqual({
      usernames: {
        Valid: 'valid-user',
        Email: 'Email',
        Snowflake: 'Snowflake'
      },
      userIds: { Valid: '123' }
    })
  })

  it('renders the full compact table without mentions', () => {
    const text = buildAvailabilityDiscordText({
      season: '42',
      players: [player({})],
      totalTokensAvailable: 2,
      totalBombsAvailable: 1,
      cappedPlayers: 0,
      filterType: 'full',
      useMentions: true,
      discordUsernames: { 'Player One': 'discord-one' },
      discordUserIds: { 'Player One': '123' }
    })

    expect(text).toContain('**GR Availability - S42**')
    expect(text).toContain('discord-one')
    expect(text).not.toContain('<@123>')
    expect(text).toContain('1h5m')
  })

  it('filters capped players and uses verified mentions', () => {
    const text = buildAvailabilityDiscordText({
      season: '42',
      players: [
        player({ display_name: 'Capped', tokens_available: 3 }),
        player({ display_name: 'Waiting', tokens_available: 1 })
      ],
      totalTokensAvailable: 4,
      totalBombsAvailable: 2,
      cappedPlayers: 1,
      filterType: 'capped',
      useMentions: true,
      discordUsernames: {},
      discordUserIds: { Capped: '456' }
    })

    expect(text).toContain('1 player: <@456>')
    expect(text).not.toContain('Waiting')
  })
})

import { describe, expect, it } from 'vitest'

import {
  sortPlayersByAvailability,
  summarizeSyncIssues
} from '@/app/components/gr-availability/useAvailabilityData'
import type { PlayerAvailability } from '@/app/components/gr-availability/types'

const row = (
  displayName: string,
  tokens: number,
  cooldown: string | null
): PlayerAvailability => ({
  player_id: displayName,
  display_name: displayName,
  tokens_available: tokens,
  bombs_available: 0,
  token_state: tokens >= 3 ? 'capped' : 'regenerating',
  data_source: 'live',
  has_api_key: true,
  token_cooldown: cooldown,
  bomb_cooldown: null,
  last_sync_at: null,
  battles_with_damage: 0
})

describe('GR availability data model', () => {
  it('sorts by token count and then soonest cooldown', () => {
    expect(
      sortPlayersByAvailability([
        row('Later', 2, '2h 0m'),
        row('Capped', 3, null),
        row('Sooner', 2, '45m')
      ]).map((player) => player.display_name)
    ).toEqual(['Capped', 'Sooner', 'Later'])
  })

  it('prefers detailed sync failures and caps their preview', () => {
    expect(
      summarizeSyncIssues({
        failedMemberDetails: [
          { player: 'A', reason: 'expired key' },
          { player: 'B' },
          { player: 'C' },
          { player: 'D' },
          { player: 'E' }
        ],
        failedMembers: ['fallback']
      })
    ).toBe('A: expired key, B, C, D, +1 more')
  })

  it('falls back to valid member names when details are absent', () => {
    expect(summarizeSyncIssues({ failedMembers: ['A', '', null, 'B'] })).toBe(
      'A, B'
    )
  })
})

import { describe, expect, it } from 'vitest'
import { scoreTeam } from '@/app/(dashboard)/guild-teams/guild-teams-shared'
import type { GuildTeamRosterEntry } from '@/app/(dashboard)/guild-teams/types'

describe('team score shared by ordering and local comparison', () => {
  it('retains canonical rank, progression, ability and tier weights including missing heroes', () => {
    const roster = new Map<string, GuildTeamRosterEntry>([
      [
        'core',
        {
          stars: 12,
          progression_index: 12,
          rank_name: 'Diamond I',
          active_ability_level: 35,
          passive_ability_level: 30
        } as GuildTeamRosterEntry
      ],
      [
        'support',
        {
          stars: 19,
          progression_index: 19,
          rank_name: 'Mythic III',
          active_ability_level: 55,
          passive_ability_level: 30
        } as GuildTeamRosterEntry
      ]
    ])
    expect(
      scoreTeam(roster, [
        { unitId: 'core', tier: 'core' },
        { unitId: 'support', tier: 'secondary' },
        { unitId: 'missing', tier: 'tertiary' }
      ])
    ).toBe(22667)
    expect(scoreTeam(roster, [{ unitId: 'core', tier: 'tertiary' }])).toBe(4222)
    expect(scoreTeam(roster, [])).toBe(0)
  })
})

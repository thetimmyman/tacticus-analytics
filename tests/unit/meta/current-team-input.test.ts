import { describe, expect, it } from 'vitest'
import { normalizeCurrentTeams } from '@/app/lib/meta/current-team-input'

describe('normalizeCurrentTeams', () => {
  it('normalizes array payloads and ignores entries without a boss type', () => {
    const result = normalizeCurrentTeams([
      {
        boss_type: 'Mortarion',
        current_team: 'A,B,C,D,E',
        encounter_index: 2
      },
      { current_team: 'ignored' }
    ])

    expect([...result.entries()]).toEqual([
      [
        'Mortarion',
        {
          boss_type: 'Mortarion',
          current_team: 'A,B,C,D,E',
          current_team_hash: null,
          encounter_index: 2,
          rarity_set: null,
          season: null
        }
      ]
    ])
  })

  it('normalizes legacy keyed payloads including shorthand strings', () => {
    const result = normalizeCurrentTeams({
      Magnus: 'A,B,C,D,E',
      Khaine: { current_team_hash: 'hash', rarity_set: 'M2' },
      Invalid: 42
    })

    expect(result.get('Magnus')).toEqual({
      boss_type: 'Magnus',
      current_team: 'A,B,C,D,E'
    })
    expect(result.get('Khaine')).toMatchObject({
      boss_type: 'Khaine',
      current_team_hash: 'hash',
      rarity_set: 'M2'
    })
    expect(result.has('Invalid')).toBe(false)
  })
})

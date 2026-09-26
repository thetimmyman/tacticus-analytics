import {
  createTeamHash,
  formatLeaderboardTimestamp,
  formatTeam,
  getSortedBossKeys,
  groupBattlesByBoss,
  type LeaderboardBattleRow
} from '../../../supabase/functions/update-discord-leaderboards/leaderboard-helpers.ts'

describe('leaderboard helpers', () => {
  it('builds a stable team hash independent of hero order', () => {
    const first = createTeamHash(
      JSON.stringify([{ unitId: 'b' }, { unitId: 'a' }]),
      JSON.stringify({ unitId: 'mow' })
    )
    const second = createTeamHash(
      JSON.stringify([{ unitId: 'a' }, { unitId: 'b' }]),
      JSON.stringify({ unitId: 'mow' })
    )
    expect(first).toBe('heroes:a,b_mow:mow')
    expect(second).toBe(first)
  })

  it('keeps the highest hit for each stable player and team', () => {
    const battles: LeaderboardBattleRow[] = [
      {
        Guild: 'ABC',
        cluster_code: 'ONE',
        set: 0,
        rarity: 'Legendary',
        encounterIndex: 0,
        userId: 'player-1',
        heroDetails: '[]',
        damageDealt: 100
      },
      {
        Guild: 'ABC',
        cluster_code: 'ONE',
        set: 0,
        rarity: 'Legendary',
        encounterIndex: 0,
        userId: 'player-1',
        heroDetails: '[]',
        damageDealt: 250
      },
      {
        Guild: 'OTHER',
        cluster_code: 'TWO',
        set: 0,
        rarity: 'Legendary',
        encounterIndex: 0,
        userId: 'player-2',
        damageDealt: 999
      }
    ]

    const grouped = groupBattlesByBoss(battles, 'ABC', 'ONE')
    expect([...grouped.keys()]).toEqual(['L1_Main'])
    expect([...grouped.get('L1_Main')!.values()]).toHaveLength(1)
    expect([...grouped.get('L1_Main')!.values()][0]?.damageDealt).toBe(250)
  })

  it('orders legendary before mythic and main before primes', () => {
    const groups = new Map([
      ['M1_Main', new Map()],
      ['L2_Prime2', new Map()],
      ['L2_Main', new Map()],
      ['L1_Prime1', new Map()]
    ])
    expect(getSortedBossKeys(groups)).toEqual([
      'L1_Prime1',
      'L2_Main',
      'L2_Prime2',
      'M1_Main'
    ])
  })

  it('formats teams and UTC timestamps for Discord', () => {
    const emojis = new Map([
      ['a', ':a:'],
      ['b', ':b:'],
      ['mow', ':mow:']
    ])
    expect(
      formatTeam(
        JSON.stringify([{ unitId: 'b' }, { unitId: 'a' }]),
        JSON.stringify({ unitId: 'mow' }),
        emojis
      )
    ).toBe(':a: :b: & :mow:')
    expect(formatLeaderboardTimestamp('2026-08-18T07:05:00Z')).toBe(
      '07:05 on 2026/08/18'
    )
  })
})

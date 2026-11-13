import { describe, expect, it } from 'vitest'
import type { SeasonTokenStats } from '@tacticus/app-core/tokens.types'
import { deriveParticipationShareRatiosFromParticipants } from '@tacticus/app-core/token-weighting'
import type {
  ClusterLeaderboardRow,
  HistoricalRankingRow
} from '@/app/lib/calculations/experimental/cluster-overall-leaderboard'
import {
  attachHistoricalRankings,
  buildLeaderboardTokenRatioMaps,
  enhanceLeaderboardPlayers,
  filterAndSortLeaderboardPlayers,
  getScoringPresentation,
  getLeaderboardRowKey,
  mapClusterLeaderboardRows
} from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/model'
import type {
  EnhancedPlayerStats,
  PlayerStats
} from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/types'

function makeRpcRow(
  overrides: Partial<ClusterLeaderboardRow> = {}
): ClusterLeaderboardRow {
  return {
    stable_key: 'alpha-key',
    display_name: 'Alpha',
    guild: 'AAA',
    user_id: 'alpha-id',
    total_damage: 1_500_000,
    battle_count: 10,
    avg_damage: 150_000,
    bombs_used: 2,
    bosses_killed: 3,
    all_battle_count: 12,
    all_bosses_killed: 4,
    percent_vs_cluster: 10,
    current_rank: 2,
    ...overrides
  }
}

function makePlayer(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    displayName: 'Alpha',
    Guild: 'AAA',
    userId: 'alpha-id',
    stableKey: 'alpha-key',
    totalDamage: 1_500_000,
    battleCount: 10,
    avgDamage: 150_000,
    battleDamageTotal: 1_500_000,
    bombsUsed: 2,
    bossesKilled: 3,
    allBattleCount: 12,
    allBossesKilled: 4,
    percentVsCluster: 10,
    currentRank: 2,
    ...overrides
  }
}

function makeEnhancedPlayer(
  overrides: Partial<EnhancedPlayerStats> = {}
): EnhancedPlayerStats {
  return {
    ...makePlayer(),
    battleWeightedPercent: 10,
    tokenWeightedPercent: null,
    tokenRatioApplied: 1,
    performanceValue: 10,
    scoreRank: 2,
    ...overrides
  }
}

describe('OverallLeaderboard model', () => {
  it('maps RPC rows into the presentation model without losing aggregate fields', () => {
    const [player] = mapClusterLeaderboardRows([
      makeRpcRow({
        total_damage: '1500000' as unknown as number,
        avg_damage: '150000' as unknown as number,
        percent_vs_cluster: null
      })
    ])

    expect(player).toEqual({
      displayName: 'Alpha',
      Guild: 'AAA',
      userId: 'alpha-id',
      stableKey: 'alpha-key',
      totalDamage: 1_500_000,
      battleCount: 10,
      avgDamage: 150_000,
      battleDamageTotal: 1_500_000,
      bombsUsed: 2,
      bossesKilled: 3,
      allBattleCount: 12,
      allBossesKilled: 4,
      percentVsCluster: undefined,
      currentRank: 2
    })
  })

  it('attaches prior-season movement and averages only matching stable keys', () => {
    const history: HistoricalRankingRow[] = [
      {
        season: '105',
        stable_key: 'alpha-key',
        display_name: 'Old Alpha',
        guild: 'OLD',
        percent_vs_cluster: 5,
        season_rank: 7
      },
      {
        season: '104',
        stable_key: 'alpha-key',
        display_name: 'Alpha',
        guild: 'AAA',
        percent_vs_cluster: 9,
        season_rank: 3
      },
      {
        season: '105',
        stable_key: 'other-key',
        display_name: 'Other',
        guild: 'OLD',
        percent_vs_cluster: 1,
        season_rank: 1
      }
    ]

    const [player] = attachHistoricalRankings(
      [makePlayer({ currentRank: 2 })],
      history,
      106
    )

    expect(player).toMatchObject({
      priorSeasonRank: 7,
      rankChange: 5,
      fiveSeasonAvgRank: 5
    })
  })

  it('prefers cluster token stats and falls back to battle participation', () => {
    const players = [
      makePlayer(),
      makePlayer({
        displayName: 'Beta',
        stableKey: 'beta-key',
        userId: 'beta-id',
        battleCount: 5
      })
    ]
    const fallback = buildLeaderboardTokenRatioMaps(players, null)

    expect(fallback.max.get('alpha-id')).toBe(1)
    expect(fallback.max.get('beta-id')).toBe(0.5)
    expect(fallback.average.get('beta')).toBeCloseTo(2 / 3)

    const stats: SeasonTokenStats[] = [
      {
        context: 'cluster',
        guild_code: 'AAA',
        cluster_code: 'C1',
        season: 106,
        players: [
          {
            player_id: 'alpha-id',
            display_name: 'Alpha',
            tokens_spent: 9,
            tokens_possible: 18
          }
        ]
      }
    ]
    const fromRpc = buildLeaderboardTokenRatioMaps(players, stats)

    expect(fromRpc.max.get('alpha-id')).toBe(0.5)
    expect(fromRpc.max.has('beta-id')).toBe(false)
  })

  it('keeps battle fields static while ranking the selected scoring basis', () => {
    const players = [
      makePlayer({
        displayName: 'Beta',
        stableKey: 'beta-key',
        userId: 'beta-id',
        percentVsCluster: 20,
        currentRank: 1
      }),
      makePlayer({ currentRank: 2 })
    ]
    const tokenWeighted = enhanceLeaderboardPlayers({
      players,
      isTokenModeActive: true,
      selectedTokenModeAvailable: true,
      selectedTokenRatios: new Map([
        ['beta-id', 0.5],
        ['alpha-id', 1]
      ])
    })

    expect(tokenWeighted[0]).toMatchObject({
      displayName: 'Beta',
      currentRank: 1,
      tokenWeightedPercent: -40,
      performanceValue: -40,
      scoreRank: 2
    })
    expect(tokenWeighted[1]).toMatchObject({
      displayName: 'Alpha',
      currentRank: 2,
      scoreRank: 1
    })
    expect(tokenWeighted[1]?.tokenWeightedPercent).toBeCloseTo(10)
    expect(tokenWeighted[1]?.performanceValue).toBeCloseTo(10)
  })

  it('filters by guild and search text before applying the requested sort', () => {
    const players = [
      makeEnhancedPlayer({
        displayName: 'Alpha',
        Guild: 'AAA',
        totalDamage: 3
      }),
      makeEnhancedPlayer({
        displayName: 'Beta',
        Guild: 'OLD',
        stableKey: 'beta-key',
        totalDamage: 9
      }),
      makeEnhancedPlayer({
        displayName: 'Gamma',
        Guild: 'AAA',
        stableKey: 'gamma-key',
        totalDamage: 6
      })
    ]

    expect(
      filterAndSortLeaderboardPlayers({
        players,
        selectedGuild: 'AAA',
        searchTerm: 'a',
        sortField: 'totalDamage',
        sortDirection: 'desc'
      }).map((player) => player.displayName)
    ).toEqual(['Gamma', 'Alpha'])

    expect(
      filterAndSortLeaderboardPlayers({
        players,
        selectedGuild: 'all',
        searchTerm: 'be',
        sortField: 'name',
        sortDirection: 'asc'
      }).map((player) => player.displayName)
    ).toEqual(['Beta'])
  })

  it('describes available and unavailable scoring modes consistently', () => {
    expect(
      getScoringPresentation({
        performanceMode: 'token-weighted',
        tokenWeightingMode: 'average',
        tokenMaxAvailable: true,
        tokenAverageAvailable: true
      })
    ).toMatchObject({
      hasAnyTokenMode: true,
      isTokenModeActive: true,
      label: 'Token Weighted (Avg)',
      tableLabel: "Tkn Wgt'd (Avg)",
      statusMessage: 'Balances performance against average token spend.'
    })

    expect(
      getScoringPresentation({
        performanceMode: 'token-weighted',
        tokenWeightingMode: 'max',
        tokenMaxAvailable: false,
        tokenAverageAvailable: false
      })
    ).toMatchObject({
      hasAnyTokenMode: false,
      isTokenModeActive: false,
      label: 'Battle Weighted',
      statusMessage:
        'Token weighting unavailable - showing battle-weighted results.'
    })
  })

  it('preserves a null current rank for an unranked row', () => {
    const [player] = mapClusterLeaderboardRows([
      makeRpcRow({ current_rank: null })
    ])

    expect(player.currentRank).toBeNull()
    expect(player.totalDamage).toBe(1_500_000)
  })

  it('ranks a mid-season mover once and leaves the minority guild row unranked', () => {
    const players = [
      makePlayer({
        displayName: 'Mover',
        Guild: 'NEW',
        stableKey: 'mover-key',
        userId: 'mover-id',
        percentVsCluster: 14,
        currentRank: 8
      }),
      makePlayer({
        displayName: 'Mover',
        Guild: 'OLD',
        stableKey: 'mover-key',
        userId: 'mover-id',
        percentVsCluster: 38,
        currentRank: null
      }),
      makePlayer({
        displayName: 'Other',
        Guild: 'AAA',
        stableKey: 'other-key',
        userId: 'other-id',
        percentVsCluster: 50,
        currentRank: 1
      })
    ]

    const enhanced = enhanceLeaderboardPlayers({
      players,
      isTokenModeActive: false,
      selectedTokenModeAvailable: false,
      selectedTokenRatios: new Map()
    })

    const primary = enhanced.find((p) => p.Guild === 'NEW')
    const minority = enhanced.find((p) => p.Guild === 'OLD')
    const other = enhanced.find((p) => p.Guild === 'AAA')

    expect(other?.scoreRank).toBe(1)
    expect(primary?.scoreRank).toBe(2)
    expect(primary?.currentRank).toBe(8)
    expect(minority?.currentRank).toBeNull()
    expect(minority?.scoreRank).toBeNull()
  })

  it('does not attach historical ranks to an unranked current row', () => {
    const history: HistoricalRankingRow[] = [
      {
        season: '105',
        stable_key: 'mover-key',
        display_name: 'Mover',
        guild: 'NEW',
        percent_vs_cluster: 5,
        season_rank: 7
      }
    ]

    const [player] = attachHistoricalRankings(
      [
        makePlayer({
          displayName: 'Mover',
          Guild: 'NEW',
          stableKey: 'mover-key',
          currentRank: null
        })
      ],
      history,
      106
    )

    expect(player.priorSeasonRank).toBeUndefined()
    expect(player.rankChange).toBeUndefined()
    expect(player.fiveSeasonAvgRank).toBeUndefined()
  })

  it('sorts unranked rows to the bottom when sorting by rank', () => {
    const players = [
      makeEnhancedPlayer({
        displayName: 'Unranked',
        stableKey: 'unranked-key',
        currentRank: null,
        scoreRank: null
      }),
      makeEnhancedPlayer({
        displayName: 'Ranked One',
        stableKey: 'ranked-one-key',
        currentRank: 1,
        scoreRank: 1
      }),
      makeEnhancedPlayer({
        displayName: 'Ranked Two',
        stableKey: 'ranked-two-key',
        currentRank: 2,
        scoreRank: 2
      })
    ]

    const ascending = filterAndSortLeaderboardPlayers({
      players,
      selectedGuild: 'all',
      searchTerm: '',
      sortField: 'rank',
      sortDirection: 'asc'
    })
    const descending = filterAndSortLeaderboardPlayers({
      players,
      selectedGuild: 'all',
      searchTerm: '',
      sortField: 'rank',
      sortDirection: 'desc'
    })

    expect(ascending.map((player) => player.displayName)).toEqual([
      'Ranked One',
      'Ranked Two',
      'Unranked'
    ])
    expect(descending.map((player) => player.displayName)).toEqual([
      'Ranked Two',
      'Ranked One',
      'Unranked'
    ])
  })

  it('counts a mover once with summed battles in the token fallback', () => {
    const players = [
      makePlayer({
        displayName: 'Mover',
        stableKey: 'mover-key',
        userId: 'mover-id',
        battleCount: 12,
        currentRank: 4
      }),
      makePlayer({
        displayName: 'Mover',
        Guild: 'OLD',
        stableKey: 'mover-key',
        userId: 'mover-id',
        battleCount: 1,
        currentRank: null
      }),
      makePlayer({
        displayName: 'Other',
        stableKey: 'other-key',
        userId: 'other-id',
        battleCount: 12,
        currentRank: 1
      })
    ]

    const fallback = buildLeaderboardTokenRatioMaps(players, null)
    const expected = deriveParticipationShareRatiosFromParticipants(
      [
        { playerId: 'mover-id', displayName: 'Mover', value: 13 },
        { playerId: 'other-id', displayName: 'Other', value: 12 }
      ],
      'max'
    )

    expect(fallback.max.get('mover-id')).toBe(expected.get('mover-id'))
    expect(fallback.max.get('other-id')).toBe(expected.get('other-id'))
    expect(fallback.max.get('mover-id')).toBe(1)
    expect(fallback.max.get('other-id')).toBeCloseTo(12 / 13)
  })

  it('counts a rename inside one guild once in the token fallback', () => {
    const players = [
      makePlayer({
        displayName: 'Old Alias',
        Guild: 'AAA',
        stableKey: 'renamed-key',
        userId: 'renamed-id',
        battleCount: 8,
        currentRank: null
      }),
      makePlayer({
        displayName: 'New Alias',
        Guild: 'AAA',
        stableKey: 'renamed-key',
        userId: 'renamed-id',
        battleCount: 8,
        currentRank: 2
      }),
      makePlayer({
        displayName: 'Other',
        stableKey: 'other-key',
        userId: 'other-id',
        battleCount: 10,
        currentRank: 1
      })
    ]

    const fallback = buildLeaderboardTokenRatioMaps(players, null)

    expect(fallback.max.get('other-id')).toBe(1)
    expect(fallback.max.get('renamed-id')).toBe(0.8)
    expect(fallback.max.get('new alias')).toBe(0.8)
    expect(fallback.max.has('old alias')).toBe(false)
  })

  it('sums a guild mover across guilds in the token fallback', () => {
    const players = [
      makePlayer({
        displayName: 'Mover',
        Guild: 'NEW',
        stableKey: 'mover-key',
        userId: 'mover-id',
        battleCount: 12,
        currentRank: 3
      }),
      makePlayer({
        displayName: 'Mover',
        Guild: 'OLD',
        stableKey: 'mover-key',
        userId: 'mover-id',
        battleCount: 1,
        currentRank: null
      }),
      makePlayer({
        displayName: 'Other',
        stableKey: 'other-key',
        userId: 'other-id',
        battleCount: 26,
        currentRank: 1
      })
    ]

    const fallback = buildLeaderboardTokenRatioMaps(players, null)

    expect(fallback.max.get('other-id')).toBe(1)
    expect(fallback.max.get('mover-id')).toBe(0.5)
  })

  it.each([false, true])(
    'ranks only the primary renamed row with token mode %s',
    (tokenMode) => {
      const players = [
        makePlayer({
          displayName: 'New Alias',
          currentRank: 1,
          percentVsCluster: 14
        }),
        makePlayer({
          displayName: 'Old Alias',
          currentRank: null,
          percentVsCluster: 38
        })
      ]
      const enhanced = enhanceLeaderboardPlayers({
        players,
        isTokenModeActive: tokenMode,
        selectedTokenModeAvailable: tokenMode,
        selectedTokenRatios: new Map([['alpha-id', 0.5]])
      })

      expect(enhanced.map((player) => player.scoreRank)).toEqual([1, null])
      expect(
        enhanced.filter((player) => player.scoreRank != null)
      ).toHaveLength(1)
    }
  )

  it('gives guild moves and renamed rows distinct row keys', () => {
    const primary = makePlayer({ Guild: 'NEW', displayName: 'New Alias' })
    const moved = makePlayer({ Guild: 'OLD', displayName: 'New Alias' })
    const renamed = makePlayer({ Guild: 'NEW', displayName: 'Old Alias' })

    expect(
      new Set([primary, moved, renamed].map(getLeaderboardRowKey)).size
    ).toBe(3)
    expect(getLeaderboardRowKey({ ...primary })).toBe(
      getLeaderboardRowKey(primary)
    )
  })
})

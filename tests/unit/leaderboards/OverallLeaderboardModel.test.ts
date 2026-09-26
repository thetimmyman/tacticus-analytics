import { describe, expect, it } from 'vitest'
import type { SeasonTokenStats } from '@tacticus/app-core/tokens.types'
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
        guild: 'BBB',
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
        Guild: 'BBB',
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
})

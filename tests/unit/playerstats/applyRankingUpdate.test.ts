import { describe, it, expect } from 'vitest'
import { mergeRankingUpdate } from '@/app/components/playerstats/utils/applyRankingUpdate'
import type {
  PlayerStats,
  RankingUpdatePayload
} from '@/app/components/playerstats/types'

describe('mergeRankingUpdate', () => {
  it('returns null when no previous stats exist', () => {
    const payload = {
      season: 'S1',
      historicalPerformance: {},
      historicalTokens: {},
      historicalTotalDamage: {},
      historicalReliability: {},
      clusterRanking: 1,
      totalPlayersInCluster: 10,
      guildRanking: 2,
      totalPlayersInGuild: 5,
      playerKey: 'player-a'
    } satisfies RankingUpdatePayload

    expect(mergeRankingUpdate(null, payload)).toBeNull()
  })

  it('returns previous stats when player keys do not match', () => {
    const previous: PlayerStats = {
      totalDamage: 10,
      avgDamagePerHit: 1,
      tokensUsed: 1,
      bombsUsed: 0,
      legendaryTokensUsed: 0,
      legendaryBombsUsed: 0,
      kills: 0,
      sweeps: 0,
      oneShots: 0,
      crashes: 0,
      vsClusterAvg: 0.1,
      vsGuildAvg: 0.2,
      bossStats: {},
      primeStats: {},
      historicalTokens: {},
      playerKey: 'player-a'
    }

    const payload = {
      season: 'S1',
      historicalPerformance: {},
      historicalTokens: {},
      historicalTotalDamage: {},
      historicalReliability: {},
      clusterRanking: 1,
      totalPlayersInCluster: 10,
      guildRanking: 2,
      totalPlayersInGuild: 5,
      playerKey: 'player-b'
    } satisfies RankingUpdatePayload

    expect(mergeRankingUpdate(previous, payload)).toBe(previous)
  })

  it('merges ranking payload into the existing season entry', () => {
    const previous: PlayerStats = {
      totalDamage: 100,
      avgDamagePerHit: 10,
      tokensUsed: 5,
      bombsUsed: 0,
      legendaryTokensUsed: 0,
      legendaryBombsUsed: 0,
      kills: 0,
      sweeps: 0,
      oneShots: 0,
      crashes: 0,
      vsClusterAvg: 0.1,
      vsGuildAvg: 0.2,
      bossStats: {},
      primeStats: {},
      historicalTokens: { S0: 1 },
      historicalTotalDamage: { S0: 100 },
      historicalReliability: { S0: 0.9 },
      historicalPerformance: {
        S1: {
          vsGuild: 0.5,
          vsCluster: 0.4,
          clusterRank: 20,
          totalPlayersInCluster: 200,
          guildRank: 5,
          totalPlayersInGuild: 50
        }
      },
      clusterRanking: 20,
      totalPlayersInCluster: 200,
      guildRanking: 5,
      totalPlayersInGuild: 50,
      playerKey: 'player-a'
    }

    const payload: RankingUpdatePayload = {
      season: 'S1',
      historicalPerformance: {
        S1: {
          vsGuild: 0.3,
          vsCluster: 0.25,
          clusterRank: 1,
          totalPlayersInCluster: 300,
          guildRank: 2,
          totalPlayersInGuild: 60
        }
      },
      historicalTokens: { S1: 10 },
      historicalTotalDamage: { S1: 1000 },
      historicalReliability: { S1: 0.8 },
      clusterRanking: 1,
      totalPlayersInCluster: 300,
      guildRanking: 2,
      totalPlayersInGuild: 60,
      playerKey: 'player-a',
      reliabilityData: {
        reliability_score: 0.9,
        consistency_rating: 'A',
        avg_performance: 1,
        performance_stddev: 0.1,
        coefficient_of_variation: 0.1,
        battles_analyzed: 10,
        performance_range_min: 0.8,
        performance_range_max: 1.2,
        season_used: 'S1'
      }
    }

    const result = mergeRankingUpdate(previous, payload)
    expect(result).not.toBeNull()
    expect(result?.clusterRanking).toBe(1)
    expect(result?.totalPlayersInCluster).toBe(300)
    expect(result?.guildRanking).toBe(2)
    expect(result?.totalPlayersInGuild).toBe(60)
    expect(result?.reliability?.reliability_score).toBe(0.9)
    expect(result?.historicalTokens.S1).toBe(10)
    expect(result?.historicalTotalDamage?.S1).toBe(1000)
    expect(result?.historicalReliability?.S1).toBe(0.8)

    expect(result?.historicalPerformance?.S1.vsGuild).toBe(0.5)
    expect(result?.historicalPerformance?.S1.vsCluster).toBe(0.4)
    expect(result?.vsGuildAvg).toBe(0.5)
    expect(result?.vsClusterAvg).toBe(0.4)
  })
})

import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.player-stats.enrich-rankings')
import type { HistoricalPerformanceEntry, ReliabilityRpcResult } from './types'
import { toNullableNumber } from '@/app/lib/utils/battle-log-performance'

export interface RankingEnrichmentParams {
  supabase: SupabaseClient
  performanceData: Record<string, HistoricalPerformanceEntry>
  resolvedPlayerId: string | null
  playerClusterCode: string | null
  guildCode: string
  seasonsWithData: string[]
  playerName: string
}

export interface RankingEnrichmentResult {
  performanceData: Record<string, HistoricalPerformanceEntry>
  historicalReliability: Record<string, number>
}

/** Variance-based reliability when the RPC has no score; null with < 2 bosses. */
export function computeReliabilityFallback(
  bossDetails: Array<{ vsGuild?: number }> | undefined
): number | null {
  const bossValues =
    bossDetails
      ?.map((detail) =>
        typeof detail.vsGuild === 'number' ? detail.vsGuild : null
      )
      .filter(
        (value): value is number => value !== null && !Number.isNaN(value)
      ) ?? []

  if (bossValues.length < 2) {
    return null
  }

  const ratios = bossValues.map((value) => 1 + value / 100)
  const average = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
  const variance =
    ratios.reduce((sum, value) => {
      const diff = value - average
      return sum + diff * diff
    }, 0) / ratios.length

  const stdDev = Math.sqrt(variance)
  if (!Number.isFinite(stdDev)) {
    return null
  }

  const coefficient =
    average !== 0
      ? Math.abs((stdDev / Math.abs(average)) * 100)
      : Math.abs(stdDev) * 100
  const fallbackScore = Math.max(0, 100 - coefficient)
  return Number(fallbackScore.toFixed(1))
}

export async function enrichWithRankingsAndReliability(
  params: RankingEnrichmentParams
): Promise<RankingEnrichmentResult> {
  const {
    supabase,
    performanceData,
    resolvedPlayerId,
    playerClusterCode,
    guildCode,
    seasonsWithData,
    playerName
  } = params

  const historicalReliability: Record<string, number> = {}

  const clusterRankPromise = (async () => {
    if (!(playerClusterCode && seasonsWithData.length > 0 && resolvedPlayerId))
      return null
    const clusterRankResults = await Promise.all(
      seasonsWithData.map(async (seasonKey) => {
        try {
          const seasonGuildForRpc =
            performanceData[seasonKey]?.guild || guildCode
          const { data, error } = await supabase
            .rpc('get_player_performance_in_cluster', {
              p_user_id: resolvedPlayerId,
              p_guild_code: seasonGuildForRpc,
              p_cluster_code: playerClusterCode,
              p_season: seasonKey
            })
            .maybeSingle()

          const typedData = data as {
            guild_rank?: number
            total_players_in_guild?: number
            cluster_rank?: number
            total_players_in_cluster?: number
          } | null
          if (!error && typedData) {
            return {
              seasonKey,
              guildRank: typedData.guild_rank || 0,
              totalPlayersInGuild: typedData.total_players_in_guild || 0,
              clusterRank: typedData.cluster_rank || 0,
              totalPlayersInCluster: typedData.total_players_in_cluster || 0
            }
          }
          return null
        } catch {
          return null
        }
      })
    )
    return clusterRankResults
  })()

  const reliabilityPromise = (async () => {
    if (!(seasonsWithData.length > 0 && resolvedPlayerId)) return
    try {
      const rpcResults = await Promise.all(
        seasonsWithData.map(async (seasonKey) => {
          const seasonGuild = performanceData[seasonKey]?.guild || guildCode
          try {
            const payload = {
              p_user_id: resolvedPlayerId,
              p_guild_code: seasonGuild,
              p_season: seasonKey,
              p_cluster_code: playerClusterCode || undefined
            }

            const { data, error } = await supabase
              .rpc('calculate_player_reliability', payload)
              .single()

            if (error) {
              logger.debug(
                {
                  error,
                  seasonKey,
                  playerName,
                  guildCode
                },
                'Reliability RPC returned error'
              )
              return null
            }

            const reliabilityData = data as ReliabilityRpcResult | null
            // `Number(null)` is 0: coercing first would plot a fabricated 0 for thin seasons.
            const numericScore = toNullableNumber(
              reliabilityData?.reliability_score
            )
            if (numericScore !== null) {
              return {
                seasonKey,
                score: Number(numericScore.toFixed(1))
              }
            }

            return null
          } catch (rpcError) {
            logger.debug(
              {
                rpcError,
                seasonKey,
                playerName,
                guildCode
              },
              'Reliability RPC failed'
            )
            return null
          }
        })
      )

      rpcResults.forEach((result) => {
        if (!result || result.score == null) return
        historicalReliability[result.seasonKey] = result.score
      })
    } catch (aggregateError) {
      logger.debug(
        {
          aggregateError,
          playerName,
          guildCode
        },
        'Reliability RPC aggregate failed'
      )
    }
  })()

  const [clusterRankResults] = await Promise.all([
    clusterRankPromise,
    reliabilityPromise
  ])

  if (clusterRankResults) {
    clusterRankResults.forEach((result) => {
      if (result) {
        const existingEntry = performanceData[result.seasonKey] ?? {
          vsGuild: 0,
          vsCluster: 0
        }
        performanceData[result.seasonKey] = {
          ...existingEntry,
          ...(result.clusterRank > 0
            ? {
                clusterRank: result.clusterRank,
                totalPlayersInCluster: result.totalPlayersInCluster
              }
            : {}),
          ...(result.guildRank > 0
            ? {
                guildRank: result.guildRank,
                totalPlayersInGuild: result.totalPlayersInGuild
              }
            : {})
        }
      }
    })
  }

  if (seasonsWithData.length > 0) {
    const seasonsNeedingFallback = seasonsWithData.filter(
      (seasonKey) => historicalReliability[seasonKey] == null
    )

    seasonsNeedingFallback.forEach((seasonKey) => {
      const entry = performanceData[seasonKey]
      const score = computeReliabilityFallback(entry?.bossDetails)
      if (score !== null) {
        historicalReliability[seasonKey] = score
      }
    })
  }

  return { performanceData, historicalReliability }
}

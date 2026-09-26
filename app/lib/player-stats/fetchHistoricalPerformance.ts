import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'lib.player-stats.fetchHistoricalPerformance'
)
import type { SupabaseClient } from '@supabase/supabase-js'
import type { HistoricalDataSets } from './types'
import { generateSeasons } from './generate-seasons'
import { resolveGuildScope } from './resolve-guild-scope'
import { resolvePlayerIdentity } from './resolve-player-identity'
import { executeBulkQueries } from './build-historical-queries'
import { aggregateSeasonPerformance } from './aggregate-season-performance'
import { enrichWithRankingsAndReliability } from './enrich-rankings'

export interface FetchHistoricalPerformanceParams {
  supabase: SupabaseClient
  playerName: string
  guildCode: string
  season: string
  playerClusterCode: string | null
}

export async function fetchHistoricalPerformance(
  params: FetchHistoricalPerformanceParams
): Promise<HistoricalDataSets> {
  const { supabase, playerName, guildCode, season, playerClusterCode } = params

  if (!playerName || !guildCode || !season) {
    return { performance: {}, tokens: {}, totalDamage: {}, reliability: {} }
  }

  try {
    const t: Record<string, number> & { start: number } = {
      start: performance.now()
    }

    const seasons = generateSeasons(season)

    const guildCodes = await resolveGuildScope(
      supabase,
      guildCode,
      playerClusterCode
    )

    const identity = await resolvePlayerIdentity(
      supabase,
      playerName,
      guildCode
    )
    let resolvedPlayerId = identity.playerId
    t.afterMapping = performance.now()

    const queryResult = await executeBulkQueries(
      supabase,
      resolvedPlayerId,
      guildCode,
      guildCodes,
      seasons,
      playerClusterCode
    )
    t.afterMainQuery = performance.now()
    t.afterGuildTransfer = performance.now()

    if (!resolvedPlayerId) {
      const fallbackUserId =
        queryResult.playerData.find((row) => row.userId)?.userId ??
        queryResult.playerTokenData.find((row) => row.userId)?.userId ??
        null
      if (fallbackUserId) {
        const normalizedUserId = String(fallbackUserId).trim()
        if (normalizedUserId) {
          resolvedPlayerId = normalizedUserId
        }
      }
    }

    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        {
          identityResolved: Boolean(resolvedPlayerId),
          clusterScoped: Boolean(playerClusterCode),
          guildCount: guildCodes.length,
          playerDataCount: queryResult.playerData.length,
          guildAvgRpcCount: queryResult.guildAvgRpcData.length,
          guildPlayerScoresCount: queryResult.guildPlayerScoresData.length,
          clusterAvgCount: queryResult.clusterAvgData.length,
          playerTokenDataCount: queryResult.playerTokenData.length
        },
        'Historical data fetched'
      )
    }

    const aggregation = aggregateSeasonPerformance({
      seasons,
      playerData: queryResult.playerData,
      playerTokenData: queryResult.playerTokenData,
      guildAvgRpcData: queryResult.guildAvgRpcData,
      additionalGuildAvgData: queryResult.additionalGuildAvgData,
      guildPlayerScoresData: queryResult.guildPlayerScoresData,
      additionalGuildScoresData: queryResult.additionalGuildScoresData,
      clusterAvgData: queryResult.clusterAvgData,
      guildCode,
      resolvedPlayerId
    })
    t.afterLocalProcessing = performance.now()

    const seasonsForEnrichment = seasons.filter((s) =>
      aggregation.seasonsWithPlayerData.has(s)
    )
    const enriched = await enrichWithRankingsAndReliability({
      supabase,
      performanceData: aggregation.performanceData,
      resolvedPlayerId,
      playerClusterCode,
      guildCode,
      seasonsWithData: seasonsForEnrichment,
      playerName
    })
    t.afterRankAndReliability = performance.now()

    const ms = (key: string) => {
      const start = t.start
      return Math.round(((t[key] as number | undefined) ?? start) - start)
    }
    logger.info(
      {
        mappingMs: ms('afterMapping'),
        mainQueryMs: ms('afterMainQuery') - ms('afterMapping'),
        guildTransferMs: ms('afterGuildTransfer') - ms('afterMainQuery'),
        localProcessingMs:
          ms('afterLocalProcessing') - ms('afterGuildTransfer'),
        rankAndReliabilityMs:
          ms('afterRankAndReliability') - ms('afterLocalProcessing'),
        totalMs: ms('afterRankAndReliability'),
        seasonsCount: seasonsForEnrichment.length
      },
      'Historical performance phase timing'
    )

    return {
      performance: enriched.performanceData,
      tokens: aggregation.historicalTokens,
      totalDamage: aggregation.historicalTotalDamage,
      reliability: enriched.historicalReliability
    }
  } catch (error) {
    logger.error(
      {
        err: error
      },
      'Error fetching historical performance'
    )
    return { performance: {}, tokens: {}, totalDamage: {}, reliability: {} }
  }
}

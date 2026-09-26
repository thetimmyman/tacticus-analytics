import { useEffect, useRef } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.playerstats.hooks.useFetchPlayerStats'
)
import type {
  PlayerStatsState,
  PlayerStatsAction,
  PlayerReliability,
  BossAssignmentDetails,
  ReliabilityRpcResult
} from '@/app/components/playerstats/types'
import { fetchTokenAvailability as fetchTokenAvailabilityAsync } from './data-fetchers'
import { toNullableNumber } from '@/app/lib/utils/battle-log-performance'
import type { HistoricalDataSets } from '@/app/components/playerstats/types'

type SupabaseClient = ReturnType<typeof dbClient>

export interface UseFetchPlayerStatsOptions {
  state: PlayerStatsState
  stateRef: React.MutableRefObject<PlayerStatsState>
  dispatch: React.Dispatch<PlayerStatsAction>
  supabaseRef: React.MutableRefObject<SupabaseClient | undefined>
  selectedGuild: string
  selectedSeason: string
  selectedPlayerName: string
  clusterCode: string
  userRole: string
  playerStatsKey: string
  weightedAveragesRef: React.MutableRefObject<
    Record<string, { vsGuild: number; vsCluster: number }>
  >
  bossRankingsFetchedRef: React.MutableRefObject<string>
}

export function parseReliabilityRpc(
  data: ReliabilityRpcResult
): PlayerReliability {
  // `Number(null)` is 0, and 0 is also a legitimate score, so the RPC's "not enough
  // battles" NULL must be detected before coercion.
  const parsedReliability = toNullableNumber(data.reliability_score)
  const parsedStddev = Number(data.performance_stddev)
  const parsedCoefficient = Number(data.coefficient_of_variation)
  const parsedAvg = Number(data.avg_performance)
  const parsedMin = Number(data.performance_range_min)
  const parsedMax = Number(data.performance_range_max)

  return {
    reliability_score: parsedReliability,
    consistency_rating:
      typeof data.consistency_rating === 'string'
        ? data.consistency_rating
        : '',
    avg_performance: Number.isFinite(parsedAvg) ? parsedAvg : 0,
    performance_stddev: Number.isFinite(parsedStddev) ? parsedStddev : 0,
    coefficient_of_variation: Number.isFinite(parsedCoefficient)
      ? parsedCoefficient
      : 0,
    battles_analyzed: Number(data.battles_analyzed) || 0,
    performance_range_min: Number.isFinite(parsedMin) ? parsedMin : 0,
    performance_range_max: Number.isFinite(parsedMax) ? parsedMax : 0,
    season_used:
      typeof data.season_used === 'string' ? data.season_used : undefined
  }
}

function calculateFallbackReliability(
  fallbackScore: number,
  performanceEntry:
    { vsGuild?: number; bossDetails?: Array<{ vsGuild?: number }> } | undefined,
  tokensUsed: number,
  season: string
): PlayerReliability {
  const vsGuildValues =
    performanceEntry?.bossDetails?.map(
      (detail: { vsGuild?: number }) => detail.vsGuild ?? 0
    ) ?? []
  const avgPerformance = performanceEntry?.vsGuild ?? 0
  const stdDev =
    vsGuildValues.length > 0
      ? Math.sqrt(
          vsGuildValues.reduce((sum, value) => {
            const diff = value - avgPerformance
            return sum + diff * diff
          }, 0) / vsGuildValues.length
        )
      : 0
  const coefficient =
    avgPerformance !== 0 ? Math.abs(stdDev / avgPerformance) : 0
  const minPerf = vsGuildValues.length > 0 ? Math.min(...vsGuildValues) : 0
  const maxPerf = vsGuildValues.length > 0 ? Math.max(...vsGuildValues) : 0
  const consistencyRating =
    fallbackScore >= 80
      ? 'Very Consistent'
      : fallbackScore >= 60
        ? 'Consistent'
        : fallbackScore >= 40
          ? 'Moderate'
          : fallbackScore >= 20
            ? 'Inconsistent'
            : 'Volatile'

  return {
    reliability_score: fallbackScore,
    consistency_rating: consistencyRating,
    avg_performance: avgPerformance,
    performance_stddev: stdDev,
    coefficient_of_variation: coefficient,
    battles_analyzed: tokensUsed,
    performance_range_min: minPerf,
    performance_range_max: maxPerf,
    season_used: season
  }
}

/** Supplemental stats after useServerStats resolves core stats and context, merged via MERGE_STATS. */
export function useFetchPlayerStats({
  state,
  stateRef,
  dispatch,
  supabaseRef,
  selectedGuild,
  selectedSeason,
  selectedPlayerName,
  clusterCode,
  userRole,
  playerStatsKey,
  weightedAveragesRef,
  bossRankingsFetchedRef
}: UseFetchPlayerStatsOptions): void {
  const lastFetchedKeyRef = useRef<string>('')

  // Stable signature so the effect fires when context is set.
  const context = state.context
  const contextSignature = context
    ? `${context.resolvedGuild}|${context.resolvedClusterCode ?? ''}|${context.mapping?.id ?? 'no-map'}`
    : null

  useEffect(() => {
    if (!selectedPlayerName) return

    const currentContext = stateRef.current.context
    if (!currentContext) return // wait for useServerStats to set context

    const season = stateRef.current.selection.season || selectedSeason
    const resolvedGuild = currentContext.resolvedGuild
    const resolvedClusterCode = currentContext.resolvedClusterCode
    const mapping = currentContext.mapping
    const effectiveClusterCode = resolvedClusterCode ?? clusterCode

    const fetchKey = `${playerStatsKey}|${resolvedGuild}|${resolvedClusterCode ?? ''}`
    if (lastFetchedKeyRef.current === fetchKey) return
    lastFetchedKeyRef.current = fetchKey

    bossRankingsFetchedRef.current = '' // allow boss rankings to re-run

    const supabaseClient = supabaseRef.current
    if (!supabaseClient) return

    const bossNamesToFetch: string[] = []
    if (mapping?.primary_boss) bossNamesToFetch.push(mapping.primary_boss)
    if (mapping?.secondary_boss) bossNamesToFetch.push(mapping.secondary_boss)

    // Token fetch is independent: it calls Tacticus (~30s) and must not block render.
    fetchTokenAvailabilityAsync({
      playerName: selectedPlayerName,
      guildCode: resolvedGuild,
      season,
      selectedGuild,
      userRole: userRole || 'member',
      effectiveClusterCode: effectiveClusterCode || ''
    })
      .then((tokenAvailability) => {
        if (lastFetchedKeyRef.current !== fetchKey) return
        if (tokenAvailability) {
          dispatch({ type: 'SET_TOKENS', payload: tokenAvailability })
        }
      })
      .catch((err) => {
        logger.error({ err: err }, 'Token availability fetch failed')
      })

    Promise.all([
      (async (): Promise<HistoricalDataSets> => {
        try {
          const params = new URLSearchParams({
            player: selectedPlayerName,
            guild_code: resolvedGuild,
            season
          })
          if (resolvedClusterCode)
            params.set('cluster_code', resolvedClusterCode)
          const res = await fetch(
            `/api/player-stats/historical-performance?${params}`
          )
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return await res.json()
        } catch (err) {
          logger.warn(
            { err: err },
            'Historical performance API failed, returning empty:'
          )
          return {
            performance: {},
            tokens: {},
            totalDamage: {},
            reliability: {}
          }
        }
      })(),
      mapping?.user_id
        ? (async (userId: string) => {
            try {
              const res = await supabaseClient
                .rpc('get_player_performance_in_cluster', {
                  p_user_id: userId,
                  p_guild_code: resolvedGuild,
                  p_cluster_code: resolvedClusterCode ?? '',
                  p_season: season
                })
                .maybeSingle()
              return { data: res.data, error: res.error }
            } catch (err) {
              return { data: null, error: err as Error }
            }
          })(mapping.user_id)
        : Promise.resolve({ data: null, error: null }),
      mapping?.user_id
        ? (async (userId: string) => {
            try {
              const res = await supabaseClient
                .rpc('calculate_player_reliability', {
                  p_user_id: userId,
                  p_guild_code: resolvedGuild,
                  p_season: season,
                  ...(resolvedClusterCode
                    ? { p_cluster_code: resolvedClusterCode }
                    : {})
                })
                .single()
              return { data: res.data, error: res.error }
            } catch (err) {
              return { data: null, error: err as Error }
            }
          })(mapping.user_id)
        : Promise.resolve({ data: null, error: null }),
      bossNamesToFetch.length > 0
        ? (async () => {
            try {
              const res = await supabaseClient
                .from('EOT_GR_data')
                .select('Name, set, rarity')
                .in('Name', bossNamesToFetch)
                .eq('Season', season)
                .eq('Guild', resolvedGuild)
                .in('rarity', ['Legendary', 'Mythic'])
                .order('startedOn', { ascending: false })
                .limit(10)
              return { data: res.data, error: res.error }
            } catch (err) {
              return { data: null, error: err as Error }
            }
          })()
        : Promise.resolve({ data: null, error: null })
    ])
      .then(
        ([
          historicalData,
          playerPerfResult,
          reliabilityResult,
          bossAssignmentsResult
        ]) => {
          if (lastFetchedKeyRef.current !== fetchKey) return

          let clusterRanking = 0
          let totalPlayersInCluster = 0
          let guildRanking = 0
          let totalPlayersInGuild = 0
          let reliabilityData: PlayerReliability | null = null

          const currentSeasonPerf = historicalData.performance[season]
          if (currentSeasonPerf) {
            clusterRanking = currentSeasonPerf.clusterRank || 0
            totalPlayersInCluster = currentSeasonPerf.totalPlayersInCluster || 0
            guildRanking = currentSeasonPerf.guildRank || 0
            totalPlayersInGuild = currentSeasonPerf.totalPlayersInGuild || 0
          }

          if (!playerPerfResult.error && playerPerfResult.data) {
            const perfData = playerPerfResult.data
            if (perfData.guild_rank && perfData.guild_rank > 0) {
              guildRanking = perfData.guild_rank
              totalPlayersInGuild = perfData.total_players_in_guild || 0
            }
            if (perfData.cluster_rank && perfData.cluster_rank > 0) {
              clusterRanking = perfData.cluster_rank
              totalPlayersInCluster = perfData.total_players_in_cluster || 0
            }
            const existingEntry = historicalData.performance[season] ?? {
              vsGuild: 0,
              vsCluster: 0
            }
            historicalData.performance[season] = {
              ...existingEntry,
              ...(perfData.guild_rank && perfData.guild_rank > 0
                ? {
                    guildRank: perfData.guild_rank,
                    totalPlayersInGuild: perfData.total_players_in_guild || 0
                  }
                : {}),
              ...(perfData.cluster_rank && perfData.cluster_rank > 0
                ? {
                    clusterRank: perfData.cluster_rank,
                    totalPlayersInCluster:
                      perfData.total_players_in_cluster || 0
                  }
                : {})
            }
          } else if (playerPerfResult.error) {
            logger.warn(
              { data: playerPerfResult.error },
              'Unable to fetch player performance ranking:'
            )
          }

          if (!reliabilityResult.error && reliabilityResult.data) {
            reliabilityData = parseReliabilityRpc(
              reliabilityResult.data as ReliabilityRpcResult
            )
          }
          if (!reliabilityData) {
            const fallbackScore = historicalData.reliability[season]
            if (typeof fallbackScore === 'number') {
              reliabilityData = calculateFallbackReliability(
                fallbackScore,
                historicalData.performance[season],
                historicalData.tokens[season] ?? 0,
                season
              )
            }
          }

          const currentStats = stateRef.current.stats
          if (!currentStats) return // core stats not yet set by useServerStats

          const appliedVsGuildAvg =
            weightedAveragesRef.current[playerStatsKey]?.vsGuild ??
            currentStats.vsGuildAvg ??
            0
          const appliedVsClusterAvg =
            weightedAveragesRef.current[playerStatsKey]?.vsCluster ??
            currentStats.vsClusterAvg ??
            0

          const nextStats = {
            ...currentStats,
            playerKey: playerStatsKey,
            historicalPerformance: historicalData.performance,
            historicalTokens: historicalData.tokens,
            historicalTotalDamage: historicalData.totalDamage,
            historicalReliability: historicalData.reliability,
            clusterRanking,
            totalPlayersInCluster,
            guildRanking,
            totalPlayersInGuild,
            reliability:
              reliabilityData ?? currentStats.reliability ?? undefined,
            vsGuildAvg: appliedVsGuildAvg,
            vsClusterAvg: appliedVsClusterAvg
          }

          weightedAveragesRef.current[playerStatsKey] = {
            vsGuild: nextStats.vsGuildAvg ?? 0,
            vsCluster: nextStats.vsClusterAvg ?? 0
          }

          dispatch({
            type: 'MERGE_STATS',
            payload: { stats: nextStats, key: playerStatsKey }
          })
          dispatch({ type: 'INCREMENT_RANKINGS' })

          let assignments: BossAssignmentDetails | null = null
          if (
            bossAssignmentsResult.data &&
            bossAssignmentsResult.data.length > 0
          ) {
            const bossData = bossAssignmentsResult.data as Array<{
              Name: string
              set: number
              rarity: string
            }>
            const details: BossAssignmentDetails = {}
            if (mapping?.primary_boss) {
              const primaryData = bossData.find(
                (b) => b.Name === mapping.primary_boss
              )
              if (primaryData) {
                details.primary = {
                  name: primaryData.Name || '',
                  set: primaryData.set || 0,
                  rarity: primaryData.rarity || 'Legendary'
                }
              }
            }
            if (mapping?.secondary_boss) {
              const secondaryData = bossData.find(
                (b) => b.Name === mapping.secondary_boss
              )
              if (secondaryData) {
                details.secondary = {
                  name: secondaryData.Name || '',
                  set: secondaryData.set || 0,
                  rarity: secondaryData.rarity || 'Legendary'
                }
              }
            }
            assignments = Object.keys(details).length > 0 ? details : null
          }

          if (assignments) {
            const prevContext = stateRef.current.context
            if (prevContext) {
              dispatch({
                type: 'SET_CONTEXT',
                payload: { ...prevContext, assignments, status: 'success' }
              })
            }
          }
        }
      )
      .catch((err) => {
        if (lastFetchedKeyRef.current !== fetchKey) return
        logger.error({ err: err }, 'Supplemental player stats fetch failed')
      })
  }, [
    playerStatsKey,
    contextSignature,
    selectedPlayerName,
    selectedGuild,
    selectedSeason,
    clusterCode,
    userRole,
    dispatch,
    stateRef,
    supabaseRef,
    weightedAveragesRef,
    bossRankingsFetchedRef
  ])
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPlayerStats } from '@/app/(dashboard)/player-stats/search/[searchName]/actions'
import {
  isStaleServerActionError,
  reloadForStaleDeploy
} from '@/app/lib/stale-server-action'
import type {
  PlayerStatsState,
  PlayerStatsAction,
  PlayerStats,
  BossStatDetail
} from '@/app/components/playerstats/types'

export interface UseServerStatsOptions {
  stateRef: React.MutableRefObject<PlayerStatsState>
  dispatch: React.Dispatch<PlayerStatsAction>
  calculationsEnabled: boolean
  selectedPlayerName: string
  resolvedGuild: string
  resolvedSeason: string
  playerStatsKey: string
}

function buildPlayerStatsFromResult(
  data: unknown,
  playerKey: string,
  previousStats: PlayerStats | null,
  samePlayer: boolean
): PlayerStats {
  const src = data as PlayerStats

  const nextBossStats: Record<string, BossStatDetail> = {}
  Object.entries(
    (src.bossStats as Record<string, BossStatDetail>) ?? {}
  ).forEach(([name, bossData]) => {
    const prior = samePlayer ? previousStats?.bossStats?.[name] : undefined
    nextBossStats[name] = { ...(prior ?? {}), ...bossData } as BossStatDetail
  })

  const nextPrimeStats: Record<string, BossStatDetail> = {}
  Object.entries(
    (src.primeStats as Record<string, BossStatDetail>) ?? {}
  ).forEach(([name, primeData]) => {
    const prior = samePlayer ? previousStats?.primeStats?.[name] : undefined
    nextPrimeStats[name] = { ...(prior ?? {}), ...primeData } as BossStatDetail
  })

  return {
    ...src,
    playerKey,
    bossStats: nextBossStats,
    primeStats: nextPrimeStats,
    // Keep loaded history for the same player; useFetchPlayerStats merges updates via MERGE_STATS.
    historicalPerformance: samePlayer
      ? (previousStats?.historicalPerformance ?? src.historicalPerformance)
      : src.historicalPerformance,
    historicalTokens: samePlayer
      ? (previousStats?.historicalTokens ?? src.historicalTokens)
      : src.historicalTokens,
    historicalTotalDamage: samePlayer
      ? (previousStats?.historicalTotalDamage ?? src.historicalTotalDamage)
      : src.historicalTotalDamage,
    historicalReliability: samePlayer
      ? (previousStats?.historicalReliability ?? src.historicalReliability)
      : src.historicalReliability,
    // Provided by useFetchPlayerStats; keep the previous values for the same player.
    clusterRanking: samePlayer ? (previousStats?.clusterRanking ?? 0) : 0,
    totalPlayersInCluster: samePlayer
      ? (previousStats?.totalPlayersInCluster ?? 0)
      : 0,
    guildRanking: samePlayer ? (previousStats?.guildRanking ?? 0) : 0,
    totalPlayersInGuild: samePlayer
      ? (previousStats?.totalPlayersInGuild ?? 0)
      : 0,
    reliability: samePlayer ? previousStats?.reliability : undefined
  }
}

export interface UseServerStatsResult {
  retry: () => void
}

/** Core stats via the server action; useFetchPlayerStats merges supplemental data. */
export function useServerStats({
  stateRef,
  dispatch,
  calculationsEnabled,
  selectedPlayerName,
  resolvedGuild,
  resolvedSeason,
  playerStatsKey
}: UseServerStatsOptions): UseServerStatsResult {
  const lastFetchedKeyRef = useRef<string>('')
  const [retryTick, setRetryTick] = useState(0)

  const retry = useCallback(() => {
    lastFetchedKeyRef.current = ''
    setRetryTick((t) => t + 1)
  }, [])

  useEffect(() => {
    if (!calculationsEnabled) return
    if (!selectedPlayerName || !resolvedGuild || !resolvedSeason) return
    if (lastFetchedKeyRef.current === playerStatsKey) return

    lastFetchedKeyRef.current = playerStatsKey

    if (stateRef.current.status !== 'loading') {
      dispatch({ type: 'SET_STATUS', payload: 'loading' })
    }
    dispatch({ type: 'SET_SUPABASE_ERROR', payload: null })

    fetchPlayerStats(selectedPlayerName, resolvedGuild, resolvedSeason)
      .then((result) => {
        if (lastFetchedKeyRef.current !== playerStatsKey) return

        if (result.error || !result.stats) {
          dispatch({
            type: 'SET_SUPABASE_ERROR',
            payload: new Error(result.error ?? 'No data found for player.')
          })
          dispatch({ type: 'SET_STATUS', payload: 'error' })
          return
        }

        const previousStats = stateRef.current.stats
        const samePlayer = previousStats?.playerKey === playerStatsKey

        const nextStats = buildPlayerStatsFromResult(
          result.stats,
          playerStatsKey,
          previousStats,
          samePlayer
        )

        if (previousStats && samePlayer) {
          dispatch({
            type: 'MERGE_STATS',
            payload: { stats: nextStats, key: playerStatsKey }
          })
        } else {
          dispatch({
            type: 'SET_STATS',
            payload: { stats: nextStats, key: playerStatsKey }
          })
        }

        if (result.context) {
          dispatch({
            type: 'SET_CONTEXT',
            payload: {
              resolvedGuild: result.context.resolvedGuild,
              resolvedGuildName: result.context.resolvedGuildName,
              resolvedClusterCode: result.context.resolvedClusterCode,
              mapping: result.context.mapping,
              assignments: null, // enriched by useFetchPlayerStats once it completes
              status: 'success'
            }
          })
        }
      })
      .catch((err) => {
        if (lastFetchedKeyRef.current !== playerStatsKey) return
        // Stale bundle calling a rolled-over deploy's action IDs: reload instead of erroring.
        if (isStaleServerActionError(err) && reloadForStaleDeploy()) return
        dispatch({
          type: 'SET_SUPABASE_ERROR',
          payload: err instanceof Error ? err : new Error(String(err))
        })
        dispatch({ type: 'SET_STATUS', payload: 'error' })
      })
  }, [
    calculationsEnabled,
    playerStatsKey,
    selectedPlayerName,
    resolvedGuild,
    resolvedSeason,
    dispatch,
    stateRef,
    retryTick
  ])

  return { retry }
}

import { useEffect } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.playerstats.hooks.useBossRankings'
)
import type {
  PlayerStatsState,
  PlayerStatsAction,
  PlayerStats
} from '@/app/components/playerstats/types'
import { fetchBossRankings as fetchBossRankingsAsync } from './data-fetchers'

type SupabaseClient = ReturnType<typeof dbClient>

export interface UseBossRankingsOptions {
  stateRef: React.MutableRefObject<PlayerStatsState>
  supabaseRef: React.MutableRefObject<SupabaseClient | undefined>
  dispatch: React.Dispatch<PlayerStatsAction>
  calculationsEnabled: boolean
  selectedPlayerName: string
  resolvedGuild: string
  resolvedSeason: string
  resolvedClusterCode: string
  playerStatsKey: string
  lastUpdatedKey: string
  bossRankingsFetchedRef: React.MutableRefObject<string>
  weightedAveragesRef: React.MutableRefObject<
    Record<string, { vsGuild: number; vsCluster: number }>
  >
}

export function useBossRankings(options: UseBossRankingsOptions): void {
  const {
    stateRef,
    supabaseRef,
    dispatch,
    calculationsEnabled,
    selectedPlayerName,
    resolvedGuild,
    resolvedSeason,
    resolvedClusterCode,
    playerStatsKey,
    lastUpdatedKey,
    bossRankingsFetchedRef,
    weightedAveragesRef
  } = options

  useEffect(() => {
    if (!calculationsEnabled) return
    if (!selectedPlayerName || !resolvedSeason || !resolvedGuild) return
    if (lastUpdatedKey !== playerStatsKey) return

    const currentStats = stateRef.current.stats
    if (!currentStats) return

    const fetchKey = `${selectedPlayerName}-${resolvedSeason}-${resolvedGuild}-${resolvedClusterCode || 'none'}`
    if (bossRankingsFetchedRef.current === fetchKey) return

    let cancelled = false
    const supabaseClient = supabaseRef.current
    if (!supabaseClient) {
      logger.error('Supabase client not initialized when loading boss rankings')
      return
    }

    const loadBossRankings = async () => {
      try {
        bossRankingsFetchedRef.current = fetchKey

        const result = await fetchBossRankingsAsync({
          supabase: supabaseClient,
          playerName: selectedPlayerName,
          guildCode: resolvedGuild,
          clusterCode: resolvedClusterCode,
          season: resolvedSeason,
          currentStats,
          mappingPlayerId: stateRef.current.context?.mapping?.player_id,
          mappingUserId: stateRef.current.context?.mapping?.user_id
        })

        if (cancelled || !result) return

        const latestStats = stateRef.current.stats
        if (!latestStats) return
        if (latestStats.playerKey && latestStats.playerKey !== playerStatsKey)
          return

        const weightedFromRef = weightedAveragesRef.current[playerStatsKey]
        const mergedStats: PlayerStats = {
          ...latestStats,
          bossStats: result.bossStats,
          primeStats: result.primeStats,
          ...(weightedFromRef
            ? {
                vsGuildAvg: weightedFromRef.vsGuild,
                vsClusterAvg: weightedFromRef.vsCluster
              }
            : {})
        }

        dispatch({
          type: 'MERGE_STATS',
          payload: { stats: mergedStats, key: playerStatsKey }
        })
        dispatch({ type: 'INCREMENT_RANKINGS' })

        if (process.env.NODE_ENV === 'development') {
          console.debug('Boss rankings merge applied', {
            playerKey: playerStatsKey,
            vsGuildAvg: mergedStats.vsGuildAvg,
            vsClusterAvg: mergedStats.vsClusterAvg
          })
        }
      } catch (error) {
        if (!cancelled) {
          logger.error({ err: error }, 'Failed to fetch boss rankings')
          bossRankingsFetchedRef.current = ''
        }
      }
    }

    loadBossRankings()

    return () => {
      cancelled = true
    }
  }, [
    calculationsEnabled,
    lastUpdatedKey,
    playerStatsKey,
    resolvedClusterCode,
    resolvedGuild,
    resolvedSeason,
    selectedPlayerName,
    dispatch,
    stateRef,
    supabaseRef,
    bossRankingsFetchedRef,
    weightedAveragesRef
  ])
}

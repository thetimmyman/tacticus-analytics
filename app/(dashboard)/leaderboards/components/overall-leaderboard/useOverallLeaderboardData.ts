'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SeasonTokenStats } from '@tacticus/app-core/tokens.types'
import { dbClient } from '@/app/lib/db/client'
import { recordCalculationMetric } from '@/app/lib/calculations/metrics'
import {
  getClusterHistoricalRankingsRPC,
  getClusterOverallLeaderboardRPC,
  type HistoricalRankingRow
} from '@/app/lib/calculations/experimental/cluster-overall-leaderboard'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { GUILD_DISPLAY_COMPACT } from '@/app/lib/guild-config-selects'
import { createComponentLogger } from '@/app/lib/logging/client'
import type { UserDataContext } from '@/app/lib/utils/data-access'
import { attachHistoricalRankings, mapClusterLeaderboardRows } from './model'
import type { PlayerStats } from './types'

const logger = createComponentLogger(
  'leaderboards.components.OverallLeaderboard'
)

interface UseOverallLeaderboardDataOptions {
  season: string
  userGuild: string
  context: UserDataContext
  contextLoading: boolean
  onPlayersLoaded: () => void
}

function useGuildLabels(uniqueGuilds: string[]) {
  const [guildLabels, setGuildLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    if (uniqueGuilds.length === 0) {
      setGuildLabels({})
      return
    }

    let isMounted = true
    const fallbackLabels = Object.fromEntries(
      uniqueGuilds.map((guild) => [guild, formatGuildDisplayLabel(null, guild)])
    )

    const loadGuildLabels = async () => {
      try {
        const { data } = await dbClient()
          .from('guild_config')
          .select(GUILD_DISPLAY_COMPACT)
          .in('guild_code', uniqueGuilds)
        if (!isMounted) return

        const nextLabels = { ...fallbackLabels }
        ;(data ?? []).forEach((guild) => {
          if (guild.guild_code) {
            nextLabels[guild.guild_code] = formatGuildDisplayLabel(
              guild,
              guild.guild_code
            )
          }
        })
        setGuildLabels(nextLabels)
      } catch {
        if (isMounted) setGuildLabels(fallbackLabels)
      }
    }

    void loadGuildLabels()
    return () => {
      isMounted = false
    }
  }, [uniqueGuilds])

  return guildLabels
}

export function useOverallLeaderboardData({
  season,
  userGuild,
  context,
  contextLoading,
  onPlayersLoaded
}: UseOverallLeaderboardDataOptions) {
  const [players, setPlayers] = useState<PlayerStats[]>([])
  const [loading, setLoading] = useState(true)
  const [rpcTokenStats, setRpcTokenStats] = useState<SeasonTokenStats[] | null>(
    null
  )

  useEffect(() => {
    const loadPlayerStats = async () => {
      const start = performance.now()
      let success = false
      let errorName: string | undefined
      let recordCount = 0

      if (contextLoading || context.accessLevel === 'none') {
        setLoading(false)
        return
      }

      setLoading(true)
      const supabase = dbClient()
      let playerArray: PlayerStats[] = []

      try {
        const rpcData = await getClusterOverallLeaderboardRPC(supabase, {
          Season: season,
          clusterCode: context.clusterCode ?? undefined
        })

        if (rpcData && rpcData.length > 0) {
          recordCount = rpcData.length
          playerArray = mapClusterLeaderboardRows(rpcData)
        } else {
          throw new Error('RPC returned no data')
        }
      } catch (rpcError) {
        logger.error(
          { err: rpcError },
          'Cluster overall leaderboard RPC failed'
        )
        setLoading(false)
        return
      }

      const currentSeasonNum = parseInt(season)
      const last5Seasons = Array.from({ length: 5 }, (_, index) =>
        (currentSeasonNum - index - 1).toString()
      )
      let historicalRows: HistoricalRankingRow[] = []

      try {
        historicalRows = await getClusterHistoricalRankingsRPC(supabase, {
          seasons: last5Seasons,
          clusterCode: context.clusterCode ?? undefined
        })
      } catch (histErr) {
        logger.warn(
          { histErr },
          'Historical rankings RPC failed, skipping history'
        )
      }

      setPlayers(
        attachHistoricalRankings(playerArray, historicalRows, currentSeasonNum)
      )
      onPlayersLoaded()
      success = true
      setLoading(false)
      recordCalculationMetric({
        id: 'cluster_overall_leaderboard',
        strategy: 'composite',
        durationMs: performance.now() - start,
        cacheHit: undefined,
        success,
        errorName,
        source: 'rpc',
        filterCount: recordCount
      })
    }

    if (!contextLoading && context.accessLevel !== 'none' && season) {
      loadPlayerStats().catch((err) => {
        const errName = err instanceof Error ? err.name : 'UnknownError'
        recordCalculationMetric({
          id: 'cluster_overall_leaderboard',
          strategy: 'composite',
          durationMs: 0,
          cacheHit: undefined,
          success: false,
          errorName: errName,
          source: 'rpc',
          filterCount: 0
        })
        setLoading(false)
        logger.error({ err }, 'Error loading cluster player stats:')
      })
    }
  }, [season, context, contextLoading, onPlayersLoaded])

  useEffect(() => {
    if (
      contextLoading ||
      context.accessLevel === 'none' ||
      !season ||
      !userGuild
    ) {
      return
    }
    const seasonNum = parseInt(season, 10)
    if (Number.isNaN(seasonNum)) return

    dbClient()
      .rpc('get_season_token_stats', {
        p_guild_code: userGuild,
        p_season: seasonNum,
        p_include_cluster: true
      })
      .then(({ data, error }) => {
        if (error) {
          logger.warn(
            { error },
            'Token stats RPC failed, falling back to battle-count proxy'
          )
          return
        }
        if (Array.isArray(data) && data.length > 0) {
          setRpcTokenStats(data as SeasonTokenStats[])
        }
      })
  }, [season, userGuild, context, contextLoading])

  const uniqueGuilds = useMemo(
    () => Array.from(new Set(players.map((player) => player.Guild))).sort(),
    [players]
  )
  const guildLabels = useGuildLabels(uniqueGuilds)

  return { players, loading, rpcTokenStats, uniqueGuilds, guildLabels }
}

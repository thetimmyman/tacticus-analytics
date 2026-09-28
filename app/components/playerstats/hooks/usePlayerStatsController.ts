import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { dbClient } from '@/app/lib/db/client'
import type {
  PlayerStatsControllerOptions,
  PlayerStatsState
} from '@/app/components/playerstats/types'
import {
  playerStatsReducer,
  createInitialState,
  buildPlayerKey
} from '@/app/components/playerstats/state'
import { usePlayerSelection } from './usePlayerSelection'
import { useBossRankings } from './useBossRankings'
import { useServerStats } from './useServerStats'
import { useAvailablePlayers } from './useAvailablePlayers'
import { useFetchPlayerStats } from './useFetchPlayerStats'

type SupabaseClient = ReturnType<typeof dbClient>

export interface PlayerStatsController {
  state: PlayerStatsState
  supabase: SupabaseClient
  clusterCode: string
  selectPlayer: (player: string) => void
  setSearchTerm: (term: string) => void
  refetchPlayers: () => Promise<void>
  fetchAvailablePlayers: () => Promise<void>
  fetchPlayerStats: () => void
}

export function usePlayerStatsController(
  options: PlayerStatsControllerOptions
): PlayerStatsController {
  const {
    selectedGuild,
    selectedSeason,
    initialSearch = '',
    userRole = 'member',
    userDisplayName = '',
    clusterCode = '',
    isRestricted = false
  } = options

  const supabase = useMemo(() => dbClient(), [])
  const supabaseRef = useRef<SupabaseClient | undefined>(undefined)
  if (!supabaseRef.current) {
    supabaseRef.current = supabase
  }

  const defaultPlayer =
    isRestricted && userDisplayName ? userDisplayName : initialSearch || ''

  const [state, dispatch] = useReducer(
    playerStatsReducer,
    { player: defaultPlayer, guild: selectedGuild, season: selectedSeason },
    createInitialState
  )

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const weightedAveragesRef = useRef<
    Record<string, { vsGuild: number; vsCluster: number }>
  >({})

  const {
    selectedPlayerName,
    setSearchTerm,
    selectPlayer,
    bossRankingsFetchedRef
  } = usePlayerSelection({
    state,
    dispatch,
    userDisplayName,
    isRestricted,
    initialSearch,
    selectedGuild,
    selectedSeason
  })

  const effectiveClusterCode = useMemo(
    () => state.context?.resolvedClusterCode ?? clusterCode,
    [state.context?.resolvedClusterCode, clusterCode]
  )

  const resolvedSeason = state.selection.season || selectedSeason
  const fallbackGuild = state.selection.guild || selectedGuild
  const resolvedGuild = useMemo(() => {
    if (!selectedPlayerName) {
      return fallbackGuild
    }
    if (state.context?.resolvedGuild) {
      return state.context.resolvedGuild
    }
    if (
      isRestricted &&
      userDisplayName &&
      selectedPlayerName === userDisplayName
    ) {
      return selectedGuild
    }
    const mappedGuild = state.playerGuildMap[selectedPlayerName]
    if (mappedGuild && mappedGuild.trim()) {
      return mappedGuild
    }
    return fallbackGuild
  }, [
    fallbackGuild,
    isRestricted,
    selectedGuild,
    selectedPlayerName,
    state.context?.resolvedGuild,
    state.playerGuildMap,
    userDisplayName
  ])

  const resolvedClusterCode = useMemo(
    () => state.context?.resolvedClusterCode ?? clusterCode,
    [clusterCode, state.context?.resolvedClusterCode]
  )

  const playerStatsKey = useMemo(
    () =>
      buildPlayerKey(selectedPlayerName, resolvedGuild, resolvedSeason || ''),
    [resolvedGuild, resolvedSeason, selectedPlayerName]
  )

  const lastUpdatedKey = state.lastUpdatedKey

  const calculationsEnabled =
    Boolean(selectedPlayerName) &&
    Boolean(resolvedSeason) &&
    Boolean(resolvedGuild)

  const { fetchAvailablePlayers, refetchPlayers } = useAvailablePlayers({
    state,
    stateRef,
    dispatch,
    supabaseRef,
    selectedGuild,
    selectedSeason,
    userRole: userRole?.toString() || 'member',
    userDisplayName,
    clusterCode,
    effectiveClusterCode,
    isRestricted
  })

  const { retry } = useServerStats({
    stateRef,
    dispatch,
    calculationsEnabled,
    selectedPlayerName,
    resolvedGuild,
    resolvedSeason,
    playerStatsKey
  })

  useFetchPlayerStats({
    state,
    stateRef,
    dispatch,
    supabaseRef,
    selectedGuild,
    selectedSeason,
    selectedPlayerName,
    clusterCode,
    userRole: userRole?.toString() || 'member',
    playerStatsKey,
    weightedAveragesRef,
    bossRankingsFetchedRef
  })

  useBossRankings({
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
  })

  const fetchPlayerStats = useCallback(() => {
    retry()
  }, [retry])

  return {
    state,
    supabase: supabaseRef.current!,
    clusterCode: effectiveClusterCode,
    selectPlayer,
    setSearchTerm,
    refetchPlayers,
    fetchAvailablePlayers,
    fetchPlayerStats
  }
}

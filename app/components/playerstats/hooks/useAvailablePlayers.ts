import { useCallback, useEffect, useRef } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.playerstats.hooks.useAvailablePlayers'
)
import type {
  PlayerStatsState,
  PlayerStatsAction
} from '@/app/components/playerstats/types'
import { fetchAvailablePlayers as fetchAvailablePlayersAsync } from './data-fetchers'

type SupabaseClient = ReturnType<typeof dbClient>

export interface UseAvailablePlayersOptions {
  state: PlayerStatsState
  stateRef: React.MutableRefObject<PlayerStatsState>
  dispatch: React.Dispatch<PlayerStatsAction>
  supabaseRef: React.MutableRefObject<SupabaseClient | undefined>
  selectedGuild: string
  selectedSeason: string
  userRole: string
  userDisplayName: string
  clusterCode: string
  effectiveClusterCode: string
  isRestricted: boolean
}

export interface UseAvailablePlayersResult {
  fetchAvailablePlayers: () => Promise<void>
  refetchPlayers: () => Promise<void>
}

export function useAvailablePlayers(
  options: UseAvailablePlayersOptions
): UseAvailablePlayersResult {
  const {
    state,
    stateRef,
    dispatch,
    supabaseRef,
    selectedGuild,
    selectedSeason,
    userRole,
    userDisplayName,
    clusterCode,
    effectiveClusterCode,
    isRestricted
  } = options

  const playersRequestRef = useRef(0)
  const lastPlayersFingerprintRef = useRef<string>('')

  useEffect(() => {
    lastPlayersFingerprintRef.current = ''
  }, [selectedGuild, effectiveClusterCode])

  const fetchAvailablePlayers = useCallback(async () => {
    const currentRequest = ++playersRequestRef.current
    const supabaseClient = supabaseRef.current
    if (!supabaseClient) {
      logger.error(
        'Supabase client not initialized when fetching available players'
      )
      return
    }
    const season = state.selection.season || selectedSeason
    const guild = state.selection.guild || selectedGuild

    const result = await fetchAvailablePlayersAsync({
      supabase: supabaseClient,
      season,
      guild,
      userRole: userRole?.toString() || 'member',
      userDisplayName,
      clusterCode: effectiveClusterCode || clusterCode,
      isRestricted
    })

    if (currentRequest !== playersRequestRef.current) return

    const nextPlayersFingerprint = JSON.stringify({
      players: result.players,
      guildMap: result.guildMap
    })

    const previousPlayers = stateRef.current.availablePlayers
    const previousGuildMap = stateRef.current.playerGuildMap

    if (
      Array.isArray(previousPlayers) &&
      Array.isArray(result.players) &&
      previousPlayers.length === result.players.length &&
      previousPlayers.every(
        (value, index) => value === result.players[index]
      ) &&
      JSON.stringify(previousGuildMap ?? {}) ===
        JSON.stringify(result.guildMap ?? {}) &&
      lastPlayersFingerprintRef.current === nextPlayersFingerprint
    ) {
      return
    }

    lastPlayersFingerprintRef.current = nextPlayersFingerprint
    dispatch({
      type: 'SET_AVAILABLE_PLAYERS',
      payload: { players: result.players, guildMap: result.guildMap }
    })
  }, [
    clusterCode,
    effectiveClusterCode,
    isRestricted,
    selectedGuild,
    selectedSeason,
    state.selection.guild,
    state.selection.season,
    userDisplayName,
    userRole,
    supabaseRef,
    stateRef,
    dispatch
  ])

  useEffect(() => {
    fetchAvailablePlayers()
  }, [fetchAvailablePlayers])

  const refetchPlayers = useCallback(async () => {
    await fetchAvailablePlayers()
  }, [fetchAvailablePlayers])

  return {
    fetchAvailablePlayers,
    refetchPlayers
  }
}

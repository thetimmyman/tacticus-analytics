import { useCallback, useEffect, useRef } from 'react'
import type {
  PlayerStatsState,
  PlayerStatsAction,
  RankingUpdatePayload
} from '@/app/components/playerstats/types'
import { normalizeText } from '@/app/components/playerstats/utils'

export interface UsePlayerSelectionOptions {
  state: PlayerStatsState
  dispatch: React.Dispatch<PlayerStatsAction>
  userDisplayName: string
  isRestricted: boolean
  initialSearch: string
  selectedGuild: string
  selectedSeason: string
}

export interface UsePlayerSelectionResult {
  selectedPlayerName: string
  setSearchTerm: (term: string) => void
  selectPlayer: (player: string) => void
  pendingRankingRef: React.MutableRefObject<RankingUpdatePayload | null>
  bossRankingsFetchedRef: React.MutableRefObject<string>
}

export function usePlayerSelection(
  options: UsePlayerSelectionOptions
): UsePlayerSelectionResult {
  const {
    state,
    dispatch,
    userDisplayName,
    isRestricted,
    initialSearch,
    selectedGuild,
    selectedSeason
  } = options

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const pendingRankingRef = useRef<RankingUpdatePayload | null>(null)
  const bossRankingsFetchedRef = useRef<string>('')

  useEffect(() => {
    if (
      stateRef.current.selection.guild === selectedGuild &&
      stateRef.current.selection.season === selectedSeason
    ) {
      return
    }
    dispatch({
      type: 'SET_SELECTION',
      payload: { guild: selectedGuild, season: selectedSeason }
    })
  }, [selectedGuild, selectedSeason, dispatch])

  const setSearchTerm = useCallback(
    (term: string) => {
      dispatch({ type: 'SET_SEARCH_TERM', payload: term })
      if (normalizeText(term) !== normalizeText(userDisplayName)) {
        pendingRankingRef.current = null
      }
    },
    [userDisplayName, dispatch]
  )

  const selectPlayer = useCallback(
    (player: string) => {
      pendingRankingRef.current = null
      bossRankingsFetchedRef.current = ''
      const normalizedPlayer = normalizeText(player)
      const normalizedUser = normalizeText(userDisplayName)
      if (normalizedPlayer && normalizedPlayer !== normalizedUser) {
        dispatch({ type: 'RESET_FOR_SEARCH', payload: { player } })
      } else {
        dispatch({ type: 'RESET_FOR_PLAYER', payload: { player } })
      }
      dispatch({ type: 'SELECT_PLAYER', payload: { player } })
    },
    [userDisplayName, dispatch]
  )

  const selectedPlayerName = state.selection.player?.trim() || ''

  useEffect(() => {
    if (isRestricted && userDisplayName) {
      if (state.selection.player !== userDisplayName) {
        dispatch({
          type: 'SELECT_PLAYER',
          payload: { player: userDisplayName }
        })
      }
      return
    }

    if (
      !state.selection.player &&
      initialSearch &&
      state.availablePlayers.length > 0
    ) {
      const matchingPlayer = state.availablePlayers.find(
        (player) => player.toLowerCase() === initialSearch.toLowerCase()
      )
      if (matchingPlayer) {
        dispatch({ type: 'SELECT_PLAYER', payload: { player: matchingPlayer } })
      }
    }
  }, [
    initialSearch,
    isRestricted,
    state.availablePlayers,
    state.selection.player,
    userDisplayName,
    dispatch
  ])

  return {
    selectedPlayerName,
    setSearchTerm,
    selectPlayer,
    pendingRankingRef,
    bossRankingsFetchedRef
  }
}

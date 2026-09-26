'use client'

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import type { SeasonTokenStats } from '@tacticus/app-core/tokens.types'
import type {
  PerformanceMode,
  TokenWeightingMode
} from '@/app/components/performance/types'
import {
  buildLeaderboardTokenRatioMaps,
  enhanceLeaderboardPlayers,
  filterAndSortLeaderboardPlayers,
  getScoringPresentation
} from './model'
import {
  ITEMS_PER_PAGE,
  type PlayerStats,
  type ScoringMode,
  type SortDirection,
  type SortField
} from './types'

interface UseOverallLeaderboardViewModelOptions {
  players: PlayerStats[]
  rpcTokenStats: SeasonTokenStats[] | null
  currentPage: number
  setCurrentPage: Dispatch<SetStateAction<number>>
}

export function useOverallLeaderboardViewModel({
  players,
  rpcTokenStats,
  currentPage,
  setCurrentPage
}: UseOverallLeaderboardViewModelOptions) {
  const [sortField, setSortField] = useState<SortField>('percentVsCluster')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [selectedGuild, setSelectedGuild] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [performanceMode, setPerformanceMode] =
    useState<PerformanceMode>('battle-weighted')
  const [tokenWeightingMode, setTokenWeightingMode] =
    useState<TokenWeightingMode>('max')

  const tokenRatioMaps = useMemo(
    () => buildLeaderboardTokenRatioMaps(players, rpcTokenStats),
    [players, rpcTokenStats]
  )
  const tokenMaxAvailable = tokenRatioMaps.max.size > 0
  const tokenAverageAvailable = tokenRatioMaps.average.size > 0
  const selectedTokenRatios =
    tokenWeightingMode === 'average'
      ? tokenRatioMaps.average
      : tokenRatioMaps.max
  const selectedTokenModeAvailable =
    tokenWeightingMode === 'average' ? tokenAverageAvailable : tokenMaxAvailable
  const isTokenModeActive =
    performanceMode === 'token-weighted' && selectedTokenModeAvailable

  useEffect(() => {
    if (performanceMode !== 'token-weighted') return

    if (tokenWeightingMode === 'max' && !tokenMaxAvailable) {
      if (tokenAverageAvailable) {
        setTokenWeightingMode('average')
        return
      }
      setPerformanceMode('battle-weighted')
      return
    }

    if (tokenWeightingMode === 'average' && !tokenAverageAvailable) {
      if (tokenMaxAvailable) {
        setTokenWeightingMode('max')
        return
      }
      setPerformanceMode('battle-weighted')
    }
  }, [
    performanceMode,
    tokenWeightingMode,
    tokenMaxAvailable,
    tokenAverageAvailable
  ])

  const enhancedPlayers = useMemo(
    () =>
      enhanceLeaderboardPlayers({
        players,
        isTokenModeActive,
        selectedTokenModeAvailable,
        selectedTokenRatios
      }),
    [
      players,
      isTokenModeActive,
      selectedTokenModeAvailable,
      selectedTokenRatios
    ]
  )
  const filteredPlayers = useMemo(
    () =>
      filterAndSortLeaderboardPlayers({
        players: enhancedPlayers,
        selectedGuild,
        searchTerm,
        sortField,
        sortDirection
      }),
    [enhancedPlayers, selectedGuild, searchTerm, sortField, sortDirection]
  )
  const totalPlayers = filteredPlayers.length
  const totalPages = Math.ceil(totalPlayers / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const currentPlayers = filteredPlayers.slice(
    startIndex,
    startIndex + ITEMS_PER_PAGE
  )
  const scoring = getScoringPresentation({
    performanceMode,
    tokenWeightingMode,
    tokenMaxAvailable,
    tokenAverageAvailable
  })

  const handleSortChange = (next: {
    key: SortField
    direction: SortDirection
  }) => {
    setSortField(next.key)
    setSortDirection(next.direction)
    setCurrentPage(1)
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setCurrentPage(1)
  }

  const handleGuildChange = (guild: string) => {
    setSelectedGuild(guild)
    setCurrentPage(1)
  }

  const handleScoringModeChange = (mode: ScoringMode) => {
    if (mode === 'battle') {
      setPerformanceMode('battle-weighted')
      return
    }

    if (mode === 'token-max') {
      if (!tokenMaxAvailable) return
      setPerformanceMode('token-weighted')
      setTokenWeightingMode('max')
      return
    }

    if (!tokenAverageAvailable) return
    setPerformanceMode('token-weighted')
    setTokenWeightingMode('average')
  }

  return {
    currentPlayers,
    totalPlayers,
    totalPages,
    sortField,
    sortDirection,
    selectedGuild,
    searchTerm,
    scoring,
    handleSortChange,
    handleSearchChange,
    handleGuildChange,
    handleScoringModeChange
  }
}

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDebounce } from '@/app/hooks/useDebounce'
import type { GuildData } from '../types'

export type SortBy = 'ranking' | 'damage' | 'players' | 'veterans' | 'warRank'

export function useGuildFiltering(guilds: GuildData[]) {
  const [selectedCluster, setSelectedCluster] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortBy>('ranking')
  const [expandedGuild, setExpandedGuild] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20) // Show 20 guilds per page

  const handleSortChange = useCallback((value: string) => {
    if (
      value === 'ranking' ||
      value === 'damage' ||
      value === 'players' ||
      value === 'veterans' ||
      value === 'warRank'
    ) {
      setSortBy(value)
    }
  }, [])

  const clusters = Array.from(
    new Set(guilds.map((g) => g.cluster_code || 'Independent'))
  ).sort((a, b) => {
    if (a === 'Independent') return 1
    if (b === 'Independent') return -1
    return a.localeCompare(b)
  })

  const filteredGuilds = useMemo(() => {
    return guilds.filter((g) => {
      const hasData =
        g.total_battles > 0 ||
        g.total_damage > 0 ||
        g.active_players > 0 ||
        (g.top_boss_hits && g.top_boss_hits.length > 0)
      if (!hasData) return false

      if (selectedCluster !== 'all') {
        if (selectedCluster === 'Independent' && g.cluster_code) return false
        if (
          selectedCluster !== 'Independent' &&
          g.cluster_code !== selectedCluster
        )
          return false
      }

      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase()
        const matchesName = g.guild_name?.toLowerCase().includes(query)
        const matchesCode = g.guild_code?.toLowerCase().includes(query)
        const matchesCluster = g.cluster_name?.toLowerCase().includes(query)
        if (!matchesName && !matchesCode && !matchesCluster) return false
      }

      return true
    })
  }, [guilds, selectedCluster, debouncedSearchQuery])

  const sortedGuilds = [...filteredGuilds].sort((a, b) => {
    switch (sortBy) {
      case 'ranking':
        if (!a.current_gr_ranking) return 1
        if (!b.current_gr_ranking) return -1
        return a.current_gr_ranking - b.current_gr_ranking
      case 'damage':
        return b.total_damage - a.total_damage
      case 'players':
        return b.active_players - a.active_players
      case 'veterans':
        return b.veteran_count - a.veteran_count
      case 'warRank':
        const aRank = a.current_war_rank || a.war_rank
        const bRank = b.current_war_rank || b.war_rank
        if (!aRank) return 1
        if (!bRank) return -1
        return aRank - bRank
      default:
        return 0
    }
  })

  const totalPages = Math.ceil(sortedGuilds.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedGuilds = sortedGuilds.slice(startIndex, endIndex)

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedCluster, debouncedSearchQuery, sortBy])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [currentPage])

  const toggleGuildExpansion = useCallback((guildCode: string) => {
    setExpandedGuild((prev) => (prev === guildCode ? null : guildCode))
  }, [])

  return {
    selectedCluster,
    setSelectedCluster,
    sortBy,
    handleSortChange,
    expandedGuild,
    toggleGuildExpansion,
    searchQuery,
    setSearchQuery,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    clusters,
    filteredGuilds,
    sortedGuilds,
    totalPages,
    startIndex,
    endIndex,
    paginatedGuilds
  }
}

'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Trophy } from 'lucide-react'
import { useGuildData, useRaritySelection, useGuildFiltering } from './hooks'
import {
  GuildCardSkeleton,
  SKELETON_CARD_COUNT
} from './components/GuildCardSkeleton'
import { GuildCard } from './components/GuildCard'
import { GuildFilterPanel } from './components/GuildFilterPanel'
import { PaginationControls } from './components/PaginationControls'
import type { ExploreContentProps } from './types'

export default function ExploreContent(_props: ExploreContentProps) {
  const hasMounted = useHasMounted()
  const { guilds, loading, refreshing, lastRefreshed, handleManualRefresh } =
    useGuildData()
  const {
    selectedRarities,
    defaultRarities,
    availableRarities,
    rarityCounts,
    handleRarityChange,
    handleRarityReset
  } = useRaritySelection(guilds)
  const {
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
  } = useGuildFiltering(guilds)

  const handleResetFilters = useCallback(() => {
    setSearchQuery('')
    setSelectedCluster('all')
    handleRarityReset()
  }, [setSearchQuery, setSelectedCluster, handleRarityReset])

  // A pager press replaces the list: put the reader at its top edge instead of
  // leaving focus on a control that moved or disabled itself. Filters that
  // reset the page never take focus, so only a pager press arms the move.
  const resultsRef = useRef<HTMLDivElement>(null)
  const moveToResults = useRef(false)
  const handlePageChange = useCallback(
    (page: number) => {
      if (page === currentPage) return
      moveToResults.current = true
      setCurrentPage(page)
    },
    [currentPage, setCurrentPage]
  )
  useEffect(() => {
    if (!moveToResults.current) return
    moveToResults.current = false
    const results = resultsRef.current
    if (!results) return
    results.focus({ preventScroll: true })
    results.scrollIntoView?.({ block: 'start' })
  }, [currentPage])

  const showSkeletons = loading && guilds.length === 0
  const skeletonGuilds = useMemo(
    () =>
      Array.from(
        { length: SKELETON_CARD_COUNT },
        (_, index) => `guild-skeleton-${index + 1}`
      ),
    []
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Filters and Controls */}
      <GuildFilterPanel
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCluster={selectedCluster}
        onClusterChange={setSelectedCluster}
        clusters={clusters}
        sortBy={sortBy}
        onSortChange={handleSortChange}
        availableRarities={availableRarities}
        selectedRarities={selectedRarities}
        defaultRarities={defaultRarities}
        rarityCounts={rarityCounts}
        onRarityChange={handleRarityChange}
        onRarityReset={handleRarityReset}
        onResetFilters={handleResetFilters}
        lastRefreshed={lastRefreshed}
        hasMounted={hasMounted}
        refreshing={refreshing}
        onRefresh={handleManualRefresh}
        showSkeletons={showSkeletons}
        filteredGuilds={filteredGuilds}
        guilds={guilds}
      />

      {/* Guild Cards */}
      <div
        ref={resultsRef}
        role="region"
        aria-label={
          totalPages > 1
            ? `Guilds, page ${currentPage} of ${totalPages}`
            : 'Guilds'
        }
        aria-busy={showSkeletons}
        tabIndex={-1}
        className="grid gap-4 scroll-mt-20 lg:scroll-mt-32 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-white focus-visible:shadow-[0_0_0_2px_black]"
      >
        {showSkeletons &&
          skeletonGuilds.map((id) => <GuildCardSkeleton key={id} />)}
        {!showSkeletons &&
          paginatedGuilds.map((guild) => (
            <GuildCard
              key={guild.guild_code}
              guild={guild}
              isExpanded={expandedGuild === guild.guild_code}
              onToggleExpand={toggleGuildExpansion}
              selectedRarities={selectedRarities}
              defaultRarities={defaultRarities}
              hasMounted={hasMounted}
            />
          ))}
        {/* Empty State */}
        {!showSkeletons && sortedGuilds.length === 0 && (
          <div className="text-center py-12">
            <Trophy className="w-12 h-12 text-(--text-tertiary) mx-auto mb-4" />
            <p className="text-secondary-wh40k">
              {loading
                ? 'Loading guild data...'
                : 'No guilds found matching your filters'}
            </p>
            <p className="text-xs text-(--text-tertiary) mt-2">
              Adjust search, cluster, or rarity filters to broaden the public
              snapshot results.
            </p>
          </div>
        )}
      </div>

      {showSkeletons && <div className="mt-6 h-12" />}

      {/* Pagination Controls */}
      {!showSkeletons && sortedGuilds.length > 0 && totalPages > 1 && (
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          startIndex={startIndex}
          endIndex={endIndex}
          totalItems={sortedGuilds.length}
          itemsPerPage={itemsPerPage}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  )
}

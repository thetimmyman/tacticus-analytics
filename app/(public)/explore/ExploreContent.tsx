'use client'

import { useMemo } from 'react'
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
        lastRefreshed={lastRefreshed}
        hasMounted={hasMounted}
        refreshing={refreshing}
        onRefresh={handleManualRefresh}
        showSkeletons={showSkeletons}
        filteredGuilds={filteredGuilds}
        guilds={guilds}
      />

      {/* Guild Cards */}
      <div className="grid gap-4">
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
          onPageChange={setCurrentPage}
        />
      )}

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
  )
}

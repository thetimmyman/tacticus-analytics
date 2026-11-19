'use client'

import { useId, useRef } from 'react'
import { TrendingUp, Filter, RefreshCw, Search } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'
import { FilterBar } from '@/app/components/ui/FilterBar'
import type { GuildData } from '../types'

interface GuildFilterPanelProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  selectedCluster: string
  onClusterChange: (cluster: string) => void
  clusters: string[]
  sortBy: string
  onSortChange: (sort: string) => void
  availableRarities: Rarity[]
  selectedRarities: Rarity[]
  defaultRarities: Rarity[]
  rarityCounts: Partial<Record<Rarity, number>>
  onRarityChange: (rarities: Rarity[]) => void
  onRarityReset: () => void
  /** Clears search, cluster and rarity together. */
  onResetFilters: () => void
  lastRefreshed: Date | null
  hasMounted: boolean
  refreshing: boolean
  onRefresh: () => void
  showSkeletons: boolean
  filteredGuilds: GuildData[]
  guilds: GuildData[]
}

const SELECT_CLASS =
  'w-full min-h-[44px] px-3 py-2 bg-(--bg-secondary) border border-(--card-border) rounded-lg text-primary-wh40k focus:outline-hidden focus:border-primary-wh40k disabled:opacity-60 disabled:cursor-not-allowed'

const sameRarities = (a: Rarity[], b: Rarity[]) =>
  a.length === b.length && a.every((rarity) => b.includes(rarity))

export function GuildFilterPanel({
  searchQuery,
  onSearchChange,
  selectedCluster,
  onClusterChange,
  clusters,
  sortBy,
  onSortChange,
  availableRarities,
  selectedRarities,
  defaultRarities,
  rarityCounts,
  onRarityChange,
  onRarityReset,
  onResetFilters,
  lastRefreshed,
  hasMounted,
  refreshing,
  onRefresh,
  showSkeletons,
  filteredGuilds,
  guilds
}: GuildFilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchId = useId()
  const clusterId = useId()
  const sortId = useId()
  const season = guilds.find((guild) => guild.season)?.season

  // Rarity only changes which boss hits each card lists, so it is the one
  // secondary setting; cluster and search narrow the list itself.
  const rarityActive =
    selectedRarities.length > 0 &&
    !sameRarities(selectedRarities, defaultRarities)
      ? 1
      : 0
  const activeCount =
    rarityActive + (searchQuery ? 1 : 0) + (selectedCluster !== 'all' ? 1 : 0)

  return (
    <div
      ref={panelRef}
      role="group"
      aria-label="Guild filters"
      tabIndex={-1}
      className="rounded-lg border border-(--card-border) bg-(--card-bg) p-3 sm:p-4 transition-colors duration-200 hover:bg-card/90"
    >
      <FilterBar
        search={
          <div className="relative w-full">
            <label htmlFor={searchId} className="sr-only">
              Search guilds, clusters, or codes
            </label>
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-(--text-tertiary)"
              aria-hidden="true"
            />
            <input
              id={searchId}
              type="text"
              placeholder="Search guilds, clusters, or codes..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              disabled={showSkeletons}
              className="w-full min-h-[44px] pl-10 pr-4 py-2 bg-(--bg-secondary) border border-(--card-border) rounded-lg text-primary-wh40k placeholder-(--text-tertiary) focus:outline-hidden focus:border-primary-wh40k disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        }
        primaryFilters={
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex-1 sm:gap-4">
            <div>
              <label
                htmlFor={clusterId}
                className="mb-1 block text-sm font-medium text-secondary-wh40k"
              >
                <Filter className="mr-1 inline h-4 w-4" aria-hidden="true" />
                Cluster
              </label>
              <select
                id={clusterId}
                value={selectedCluster}
                onChange={(e) => onClusterChange(e.target.value)}
                disabled={showSkeletons}
                className={SELECT_CLASS}
              >
                <option value="all">All Clusters</option>
                {clusters.map((cluster) => (
                  <option key={cluster} value={cluster}>
                    {cluster === 'Independent'
                      ? 'Independent Guilds'
                      : `${cluster} Cluster`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={sortId}
                className="mb-1 block text-sm font-medium text-secondary-wh40k"
              >
                <TrendingUp
                  className="mr-1 inline h-4 w-4"
                  aria-hidden="true"
                />
                Sort By
              </label>
              <select
                id={sortId}
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value)}
                disabled={showSkeletons}
                className={SELECT_CLASS}
              >
                <option value="ranking">GR Ranking</option>
                <option value="warRank">War Ranking</option>
                <option value="damage">Total Damage</option>
                <option value="players">Active Players</option>
              </select>
            </div>
          </div>
        }
        secondaryLabel="Rarity"
        secondaryOpenOnWide
        secondaryFilters={
          showSkeletons ? (
            <div className="flex w-full flex-wrap gap-2">
              {[
                'rarity-skel-1',
                'rarity-skel-2',
                'rarity-skel-3',
                'rarity-skel-4'
              ].map((id) => (
                <div
                  key={id}
                  className="h-6 w-20 rounded-full bg-white/5 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <RarityFilterControls
              availableRarities={availableRarities}
              selectedRarities={selectedRarities}
              defaultRarities={defaultRarities}
              onChange={onRarityChange}
              onReset={onRarityReset}
              counts={rarityCounts}
              label="Rarity"
              hideIfSingle={false}
            />
          )
        }
        activeSecondaryCount={rarityActive}
        activeCount={activeCount}
        onReset={() => {
          onResetFilters()
          // The Reset button unmounts once nothing is active; keep focus here.
          panelRef.current?.focus({ preventScroll: true })
        }}
        actions={
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || showSkeletons}
            className="flex min-h-[44px] items-center gap-2 px-3 py-1.5 bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] rounded-lg text-(--primary) text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
        }
      >
        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-2 border-t border-(--card-border) pt-3 sm:gap-4">
          {showSkeletons ? (
            [
              'summary-guilds',
              'summary-players',
              'summary-damage',
              'summary-season'
            ].map((id) => (
              // Same heights as the loaded figures, so the cards do not jump.
              <div key={id} className="text-center">
                <div className="mx-auto h-7 w-14 rounded-sm bg-white/5 animate-pulse sm:h-8" />
                <div className="min-h-8 pt-1 sm:min-h-4">
                  <div className="mx-auto h-3 w-12 rounded-sm bg-white/5 animate-pulse" />
                </div>
              </div>
            ))
          ) : (
            <>
              <div className="text-center">
                <div className="text-lg sm:text-2xl font-bold text-(--primary)">
                  {filteredGuilds.length}
                </div>
                <div className="text-xs text-secondary-wh40k">Guilds</div>
              </div>
              <div className="text-center">
                <div className="text-lg sm:text-2xl font-bold text-(--accent)">
                  {formatNumber(
                    filteredGuilds.reduce((sum, g) => sum + g.active_players, 0)
                  )}
                </div>
                <div className="text-xs text-secondary-wh40k">
                  Total Players
                </div>
              </div>
              <div className="text-center">
                <div className="text-lg sm:text-2xl font-bold text-green-400">
                  {formatNumber(
                    filteredGuilds.reduce((sum, g) => sum + g.total_damage, 0)
                  )}
                </div>
                <div className="text-xs text-secondary-wh40k">Total Damage</div>
              </div>
              <div className="text-center">
                <div
                  className="text-lg sm:text-2xl font-bold text-blue-400"
                  data-testid="explore-season"
                >
                  {season || '\u2014'}
                </div>
                <div className="text-xs text-secondary-wh40k">
                  Current Season
                </div>
              </div>
            </>
          )}
        </div>
        <div className="min-h-5 text-sm text-(--text-tertiary) text-center sm:text-left">
          Last updated:{' '}
          {lastRefreshed && hasMounted
            ? lastRefreshed.toLocaleTimeString()
            : '\u2014'}
        </div>
      </FilterBar>
    </div>
  )
}

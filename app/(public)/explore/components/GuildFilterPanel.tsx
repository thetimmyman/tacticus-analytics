'use client'

import { TrendingUp, Filter, RefreshCw, Search } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'
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
  lastRefreshed: Date | null
  hasMounted: boolean
  refreshing: boolean
  onRefresh: () => void
  showSkeletons: boolean
  filteredGuilds: GuildData[]
  guilds: GuildData[]
}

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
  lastRefreshed,
  hasMounted,
  refreshing,
  onRefresh,
  showSkeletons,
  filteredGuilds,
  guilds
}: GuildFilterPanelProps) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-3 sm:p-4 transition-colors duration-200 hover:bg-card/90 min-h-[280px]">
      {/* Search Bar */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="Search guilds, clusters, or codes..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={showSkeletons}
            className="w-full pl-10 pr-4 py-2 bg-[var(--bg-secondary)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Cluster Filter */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            <Filter className="w-4 h-4 inline mr-1" />
            Cluster
          </label>
          <select
            value={selectedCluster}
            onChange={(e) => onClusterChange(e.target.value)}
            disabled={showSkeletons}
            className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-60 disabled:cursor-not-allowed"
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

        {/* Sort By */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            <TrendingUp className="w-4 h-4 inline mr-1" />
            Sort By
          </label>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            disabled={showSkeletons}
            className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="ranking">GR Ranking</option>
            <option value="warRank">War Ranking</option>
            <option value="damage">Total Damage</option>
            <option value="players">Active Players</option>
          </select>
        </div>
      </div>

      <div className="mt-3 min-h-[88px]">
        {showSkeletons ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              'rarity-skel-1',
              'rarity-skel-2',
              'rarity-skel-3',
              'rarity-skel-4'
            ].map((id) => (
              <div
                key={id}
                className="h-10 rounded-lg bg-white/5 animate-pulse"
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
        )}
      </div>

      {/* Refresh Button and Last Updated */}
      <div className="mt-4 pt-4 border-t border-[var(--card-border)] flex justify-between items-center mb-4">
        <div className="text-sm text-[var(--text-tertiary)]">
          {lastRefreshed && hasMounted && (
            <>
              Last updated:{' '}
              {
                // eslint-disable-next-line no-restricted-syntax
                lastRefreshed.toLocaleTimeString()
              }
            </>
          )}
          {lastRefreshed && !hasMounted && <>Last updated: &mdash;</>}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing || showSkeletons}
          className="flex items-center gap-2 px-3 py-1.5 bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] rounded-lg text-[var(--primary)] text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw
            className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
          />
          {refreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 min-h-[92px]">
        {showSkeletons ? (
          [
            'summary-guilds',
            'summary-players',
            'summary-damage',
            'summary-season'
          ].map((id) => (
            <div key={id} className="text-center space-y-2">
              <div className="mx-auto h-6 w-20 rounded bg-white/5 animate-pulse" />
              <div className="mx-auto h-3 w-24 rounded bg-white/5 animate-pulse" />
            </div>
          ))
        ) : (
          <>
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-[var(--primary)]">
                {filteredGuilds.length}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">Guilds</div>
            </div>
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-[var(--accent)]">
                {formatNumber(
                  filteredGuilds.reduce((sum, g) => sum + g.active_players, 0)
                )}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Total Players
              </div>
            </div>
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-green-400">
                {formatNumber(
                  filteredGuilds.reduce((sum, g) => sum + g.total_damage, 0)
                )}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Total Damage
              </div>
            </div>
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-blue-400">
                {guilds[0]?.season || '83'}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Current Season
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

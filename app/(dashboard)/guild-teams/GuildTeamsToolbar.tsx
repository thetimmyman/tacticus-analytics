'use client'

import type { Dispatch, RefObject, SetStateAction } from 'react'
import Image from 'next/image'
import { Check, ChevronDown, X } from 'lucide-react'
import type { RaidTeamDefinition } from '@/app/lib/constants/guild-raid-teams'
import {
  MIN_STARS_OPTIONS,
  MIN_RANK_OPTIONS,
  TIER_LABELS,
  type HeroMappingInfo,
  type SortField,
  type SortDirection
} from './guild-teams-shared'

interface GuildTeamsToolbarProps {
  sortField: SortField
  sortDirection: SortDirection
  sortHeroUnitId: string | null
  selectedTeam: RaidTeamDefinition
  heroMappings: Record<string, HeroMappingInfo>
  heroFilterRef: RefObject<HTMLDivElement | null>
  heroFilterOpen: boolean
  selectedHeroUnitIds: Set<string> | null
  minStars: number
  minRank: number
  roleFilter: string
  searchQuery: string
  handleSortFieldChange: (field: SortField) => void
  handleHeroFilterToggle: (unitId: string) => void
  setSortDirection: Dispatch<SetStateAction<SortDirection>>
  setHeroFilterOpen: Dispatch<SetStateAction<boolean>>
  setSelectedHeroUnitIds: Dispatch<SetStateAction<Set<string> | null>>
  setMinStars: Dispatch<SetStateAction<number>>
  setMinRank: Dispatch<SetStateAction<number>>
  setRoleFilter: Dispatch<SetStateAction<string>>
  setSearchQuery: Dispatch<SetStateAction<string>>
}

export function GuildTeamsToolbar({
  sortField,
  sortDirection,
  sortHeroUnitId,
  selectedTeam,
  heroMappings,
  heroFilterRef,
  heroFilterOpen,
  selectedHeroUnitIds,
  minStars,
  minRank,
  roleFilter,
  searchQuery,
  handleSortFieldChange,
  handleHeroFilterToggle,
  setSortDirection,
  setHeroFilterOpen,
  setSelectedHeroUnitIds,
  setMinStars,
  setMinRank,
  setRoleFilter,
  setSearchQuery
}: GuildTeamsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 bg-card/40 rounded-lg px-3 py-2 text-sm">
      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          Sort
        </span>
        <button
          onClick={() => handleSortFieldChange('name')}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            sortField === 'name'
              ? 'bg-indigo-600 text-white'
              : 'text-[var(--text-secondary)] hover:text-white hover:bg-card/50'
          }`}
        >
          Name
        </button>
        <button
          onClick={() => handleSortFieldChange('team_score')}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            sortField === 'team_score'
              ? 'bg-indigo-600 text-white'
              : 'text-[var(--text-secondary)] hover:text-white hover:bg-card/50'
          }`}
        >
          Team Score
        </button>
        {sortField === 'hero' && sortHeroUnitId && (
          <span className="px-2 py-1 rounded text-xs font-medium bg-indigo-600 text-white">
            {heroMappings[sortHeroUnitId]?.display_name ?? sortHeroUnitId}
          </span>
        )}
        <button
          onClick={() =>
            setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
          }
          className="px-2 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-white hover:bg-card/50 transition-colors"
          title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortDirection === 'asc' ? '\u2191' : '\u2193'}
        </button>
      </div>

      <div className="w-px h-5 bg-[var(--card-bg)]" />

      {/* Filter: Hero multi-select */}
      {selectedTeam.heroes.length > 0 && (
        <div className="relative" ref={heroFilterRef}>
          <button
            onClick={() => setHeroFilterOpen((o) => !o)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              selectedHeroUnitIds !== null
                ? 'bg-indigo-600 text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-card/50'
            }`}
          >
            Heroes
            {selectedHeroUnitIds !== null && (
              <span className="ml-0.5 text-[10px] opacity-80">
                ({selectedHeroUnitIds.size}/{selectedTeam.heroes.length})
              </span>
            )}
            <ChevronDown className="w-3 h-3" />
          </button>
          {heroFilterOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl min-w-[200px] max-h-[320px] overflow-y-auto">
              <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--card-border)]">
                <button
                  onClick={() => {
                    setSelectedHeroUnitIds(null)
                  }}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300"
                >
                  All
                </button>
                <button
                  onClick={() => setHeroFilterOpen(false)}
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              {(['core', 'secondary', 'tertiary'] as const).map((tier) => {
                const tierHeroes = selectedTeam.heroes.filter(
                  (h) => h.tier === tier
                )
                if (tierHeroes.length === 0) return null
                return (
                  <div key={tier}>
                    <div className="px-2 py-1 text-[10px] text-[var(--text-secondary)] uppercase tracking-wider bg-card/50">
                      {TIER_LABELS[tier]}
                    </div>
                    {tierHeroes.map((hero) => {
                      const mapping = heroMappings[hero.unitId]
                      const isSelected =
                        selectedHeroUnitIds === null ||
                        selectedHeroUnitIds.has(hero.unitId)
                      return (
                        <button
                          key={hero.unitId}
                          onClick={() => handleHeroFilterToggle(hero.unitId)}
                          className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-card/50 transition-colors"
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center ${
                              isSelected
                                ? 'bg-indigo-600 border-indigo-500'
                                : 'border-[var(--card-border)]'
                            }`}
                          >
                            {isSelected && (
                              <Check className="w-3 h-3 text-white" />
                            )}
                          </div>
                          {mapping?.web_icon_url && (
                            <Image
                              src={mapping.web_icon_url}
                              alt=""
                              width={18}
                              height={18}
                              className="rounded-sm"
                              unoptimized
                            />
                          )}
                          <span className="text-xs text-[var(--text-primary)] truncate">
                            {mapping?.display_name ?? hero.displayName}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Filter: Min Stars */}
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          Stars
        </span>
        <select
          value={minStars}
          onChange={(e) => setMinStars(Number(e.target.value))}
          className="bg-[var(--card-bg)] text-[var(--text-primary)] text-xs rounded px-1.5 py-1 border border-[var(--card-border)] focus:border-indigo-500 focus:outline-none"
        >
          {MIN_STARS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Filter: Min Rank */}
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          Rank
        </span>
        <select
          value={minRank}
          onChange={(e) => setMinRank(Number(e.target.value))}
          className="bg-[var(--card-bg)] text-[var(--text-primary)] text-xs rounded px-1.5 py-1 border border-[var(--card-border)] focus:border-indigo-500 focus:outline-none"
        >
          {MIN_RANK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Filter: Role */}
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          Role
        </span>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="bg-[var(--card-bg)] text-[var(--text-primary)] text-xs rounded px-1.5 py-1 border border-[var(--card-border)] focus:border-indigo-500 focus:outline-none"
        >
          <option value="all">All</option>
          <option value="leader">Leader</option>
          <option value="officer">Officer</option>
          <option value="member">Member</option>
        </select>
      </div>

      <div className="w-px h-5 bg-[var(--card-bg)]" />

      {/* Search */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search player..."
          className="bg-[var(--card-bg)] text-[var(--text-primary)] text-xs rounded px-2 py-1 border border-[var(--card-border)] focus:border-indigo-500 focus:outline-none w-32 placeholder-gray-500"
        />
      </div>
    </div>
  )
}

'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { getMetaTeamBadgeClasses } from '@/app/lib/meta/meta-team-styling'
import {
  FACTIONS,
  GRAND_ALLIANCES,
  RANK_TIERS,
  RARITIES
} from '../_lib/roster-constants'
import type { RosterFiltersApi } from '../_lib/useRosterFilters'

/** Native select with our own chevron, so dropdowns share one height across platforms. */
export function RosterSelect({
  value,
  onChange,
  ariaLabel,
  className = '',
  children
}: {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="input-wh40k h-9 w-full appearance-none truncate py-0 pl-3 pr-8"
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-wh40k"
      />
    </div>
  )
}

function activeFilterCount(rf: RosterFiltersApi) {
  return (
    [
      rf.factionFilter,
      rf.allianceFilter,
      rf.rarityFilter,
      rf.rankTierFilter,
      rf.abilityMinFilter,
      rf.abilityMaxFilter
    ].filter(Boolean).length + (rf.metaTeamFilter.length > 0 ? 1 : 0)
  )
}

/** On phones only search and the toggle show until expanded. */
export function RosterFilterBar({ rf }: { rf: RosterFiltersApi }) {
  const [open, setOpen] = useState(false)
  const activeCount = activeFilterCount(rf)

  const clearAll = () => {
    rf.setFactionFilter('')
    rf.setAllianceFilter('')
    rf.setRarityFilter('')
    rf.setRankTierFilter('')
    rf.setAbilityMinFilter('')
    rf.setAbilityMaxFilter('')
    rf.setMetaTeamFilter([])
  }

  return (
    <div className="card-wh40k p-3 mb-4">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-wh40k" />
            <input
              type="text"
              placeholder="Search characters..."
              aria-label="Search characters"
              value={rf.searchTerm}
              onChange={(event) => rf.setSearchTerm(event.target.value)}
              className="input-wh40k h-9 w-full py-0 pl-10"
            />
          </div>
          <button
            type="button"
            onClick={() => setOpen((previous) => !previous)}
            aria-expanded={open}
            aria-controls="roster-filter-panel"
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded border px-2.5 text-sm transition-colors sm:hidden ${
              activeCount > 0
                ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] text-(--accent)'
                : 'border-(--card-border) text-secondary-wh40k'
            } bg-(--bg-secondary)`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-accent-wh40k px-1.5 text-[10px] font-bold leading-4 text-(--bg-primary)">
                {activeCount}
              </span>
            )}
            <ChevronDown
              aria-hidden="true"
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        <div
          id="roster-filter-panel"
          className={`${open ? 'flex' : 'hidden'} flex-col gap-2 sm:flex`}
        >
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <RosterSelect
              value={rf.factionFilter}
              onChange={rf.setFactionFilter}
              ariaLabel="Faction"
              className="sm:w-44"
            >
              <option value="">All Factions</option>
              {FACTIONS.map((faction) => (
                <option key={faction.id} value={faction.id}>
                  {faction.label}
                </option>
              ))}
            </RosterSelect>
            <RosterSelect
              value={rf.allianceFilter}
              onChange={rf.setAllianceFilter}
              ariaLabel="Alliance"
              className="sm:w-40"
            >
              <option value="">All Alliances</option>
              {GRAND_ALLIANCES.map((alliance) => (
                <option key={alliance} value={alliance}>
                  {alliance}
                </option>
              ))}
            </RosterSelect>
            <RosterSelect
              value={rf.rarityFilter}
              onChange={rf.setRarityFilter}
              ariaLabel="Rarity"
              className="sm:w-36"
            >
              <option value="">All Rarities</option>
              {RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {rarity}
                </option>
              ))}
            </RosterSelect>
            <RosterSelect
              value={rf.rankTierFilter}
              onChange={rf.setRankTierFilter}
              ariaLabel="Rank tier"
              className="sm:w-36"
            >
              {RANK_TIERS.map((tier) => (
                <option key={tier.value} value={tier.value}>
                  {tier.label}
                </option>
              ))}
            </RosterSelect>
            <div className="col-span-2 flex items-center gap-1 sm:col-span-1">
              <span className="whitespace-nowrap text-xs text-secondary-wh40k">
                Abilities:
              </span>
              <input
                type="number"
                min="1"
                max="6"
                placeholder="Min"
                aria-label="Minimum ability level"
                value={rf.abilityMinFilter}
                onChange={(event) => rf.setAbilityMinFilter(event.target.value)}
                className="input-wh40k h-9 w-16 py-0 text-center"
              />
              <span className="text-secondary-wh40k">-</span>
              <input
                type="number"
                min="1"
                max="6"
                placeholder="Max"
                aria-label="Maximum ability level"
                value={rf.abilityMaxFilter}
                onChange={(event) => rf.setAbilityMaxFilter(event.target.value)}
                className="input-wh40k h-9 w-16 py-0 text-center"
              />
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="ml-auto inline-flex h-9 items-center gap-1 rounded-sm border border-red-500/50 px-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 sm:hidden"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
            </div>
          </div>
          {!rf.metaTeamsLoading && rf.metaTeams.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="whitespace-nowrap text-xs text-secondary-wh40k">
                Meta Teams:
              </span>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {rf.metaTeams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    aria-pressed={rf.metaTeamFilter.includes(team.id)}
                    onClick={() => {
                      rf.setMetaTeamFilter((previous) =>
                        previous.includes(team.id)
                          ? previous.filter((id) => id !== team.id)
                          : [...previous, team.id]
                      )
                    }}
                    className={`rounded-full border px-2 py-1 text-xs font-medium transition-all ${getMetaTeamBadgeClasses(team.team_name, rf.metaTeamFilter.includes(team.id))}`}
                  >
                    {team.team_name}
                  </button>
                ))}
                {rf.metaTeamFilter.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => rf.setMetaTeamFilter([])}
                      className="rounded-full border border-red-500/50 px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      Clear
                    </button>
                    {rf.metaHeroesLoading ? (
                      <span className="text-xs text-secondary-wh40k">
                        Loading...
                      </span>
                    ) : (
                      <span className="text-xs text-secondary-wh40k">
                        ({rf.teamCount} teams, {rf.expandedHeroNames.size}{' '}
                        heroes)
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

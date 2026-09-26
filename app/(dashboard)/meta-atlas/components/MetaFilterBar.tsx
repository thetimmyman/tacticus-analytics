'use client'

import { useState } from 'react'
import { ChevronDown, SlidersHorizontal, Target } from 'lucide-react'
import { getMetaTeamBadgeClasses } from '@/app/lib/meta/meta-team-styling'
import {
  META_BADGE_NAMES,
  type MetaBadgeName
} from '@/app/lib/meta/meta-team-names'
import { BossSearchCombobox } from './BossSearchCombobox'
import type { CurrentSeasonBoss } from '../types'

// Archetype glossary typed against canonical badge names, so renames fail to compile.
const META_TEAM_GLOSSARY: ReadonlyArray<{
  label: MetaBadgeName
  description: string
}> = [
  { label: 'Admech', description: 'AdMech teams built around Exitor-Rho' },
  { label: "Neuro / Z'Kar", description: "Teams with Neurothrope or Z'Kar" },
  {
    label: 'Double Howl',
    description: "Double-howl buff teams with Aun'shi and Ragnar"
  },
  {
    label: 'Orkz',
    description: 'Da Boyzzz WAAAGH with Snotflogga and Boss Gulgortz'
  },
  { label: 'Custodes', description: 'Teams with Trajann and Kariyan' },
  { label: 'Helbrecht', description: 'High Marshal Helbrecht teams' },
  { label: 'Forcasmo', description: 'Teams with Asmodai and Forcas' }
]

// Badges without a trigger-hero definition, derived so the footnote stays in sync.
const GLOSSARY_LABELS = new Set<string>(
  META_TEAM_GLOSSARY.map((entry) => entry.label)
)
const UNDESCRIBED_BADGES = META_BADGE_NAMES.filter(
  (name) => !GLOSSARY_LABELS.has(name)
)

export type MetaFilterBarProps = {
  bossFilter: string
  onBossFilterChange: (value: string) => void
  showAllBosses: boolean
  onToggleShowAll: () => void
  raritySets: string[]
  selectedRaritySets: Set<string>
  onToggleRaritySet: (raritySet: string) => void
  onSelectAllRaritySets: () => void
  onClearRaritySets: () => void
  metaTeams: string[]
  selectedMetaTeams: Set<string>
  onToggleMetaTeam: (team: string) => void
  onClearMetaTeams: () => void
  displayBossCount: number
  currentSeason?: string | null
  currentSeasonBosses?: CurrentSeasonBoss[]
  allBosses?: string[]
}

export type MetaFilterControls = Pick<
  MetaFilterBarProps,
  | 'bossFilter'
  | 'onBossFilterChange'
  | 'showAllBosses'
  | 'onToggleShowAll'
  | 'selectedRaritySets'
  | 'onToggleRaritySet'
  | 'onSelectAllRaritySets'
  | 'onClearRaritySets'
  | 'selectedMetaTeams'
  | 'onToggleMetaTeam'
  | 'onClearMetaTeams'
  | 'displayBossCount'
>

export function MetaFilterBar({
  bossFilter,
  onBossFilterChange,
  showAllBosses,
  onToggleShowAll,
  raritySets,
  selectedRaritySets,
  onToggleRaritySet,
  onSelectAllRaritySets,
  onClearRaritySets,
  metaTeams,
  selectedMetaTeams,
  onToggleMetaTeam,
  onClearMetaTeams,
  displayBossCount,
  currentSeason,
  currentSeasonBosses = [],
  allBosses = []
}: MetaFilterBarProps) {
  // `null` = undecided: collapsed unless a non-default filter (e.g. a shared link) opens it.
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const hasEveryRaritySet =
    raritySets.length > 0 &&
    selectedRaritySets.size === raritySets.length &&
    raritySets.every((raritySet) => selectedRaritySets.has(raritySet))
  const hasRarityFilter =
    raritySets.length > 0 && selectedRaritySets.size > 0 && !hasEveryRaritySet
  const canSelectAllRaritySets = raritySets.length > 0 && !hasEveryRaritySet
  const hasNonDefaultFilters = selectedMetaTeams.size > 0 || hasRarityFilter
  const isExpanded = expanded ?? hasNonDefaultFilters

  const activeFilterCount =
    selectedMetaTeams.size + (hasRarityFilter ? selectedRaritySets.size : 0)

  const getRaritySetColor = (rs: string, isSelected: boolean): string => {
    const isMythic = rs.startsWith('M')
    if (isSelected) {
      return isMythic
        ? 'bg-orange-500/40 text-orange-200 border-orange-400 ring-2 ring-offset-1 ring-offset-slate-900'
        : 'bg-cyan-500/40 text-cyan-200 border-cyan-400 ring-2 ring-offset-1 ring-offset-slate-900'
    }
    return isMythic
      ? 'bg-orange-600/20 text-orange-400 border-orange-600/30 hover:bg-orange-600/30'
      : 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30 hover:bg-cyan-600/30'
  }

  return (
    <>
      <div className="card-wh40k p-4">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <BossSearchCombobox
            bosses={currentSeasonBosses}
            currentSeasonBosses={currentSeasonBosses}
            allBosses={allBosses}
            selectedBoss={null}
            onSelectBoss={() => {}}
            searchValue={bossFilter}
            onSearchChange={onBossFilterChange}
            showAllBosses={showAllBosses}
            onToggleShowAll={onToggleShowAll}
            currentSeason={currentSeason}
            placeholder="Search bosses..."
          />

          <button
            type="button"
            onClick={() => setExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-controls="meta-filter-panel"
            className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--card-bg)] text-[var(--text-secondary)] border border-[var(--card-border)] transition-colors hover:text-white"
          >
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-purple-500/30 px-1.5 py-0.5 text-[10px] font-medium text-purple-200">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown
              aria-hidden="true"
              className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Kept mounted so <details> and chip scroll survive collapse. */}
        <div id="meta-filter-panel" className={isExpanded ? '' : 'hidden'}>
          <div className="flex flex-wrap gap-2 mt-4">
            <span className="text-sm text-[var(--text-secondary)] self-center mr-2">
              Rarity/Set:
            </span>
            {raritySets.map((rs) => (
              <button
                key={rs}
                type="button"
                onClick={() => onToggleRaritySet(rs)}
                aria-pressed={selectedRaritySets.has(rs)}
                className={`min-h-11 min-w-11 px-2 py-1 text-xs rounded-full font-medium transition-all border ${getRaritySetColor(rs, selectedRaritySets.has(rs))}`}
              >
                {rs}
              </button>
            ))}
            {canSelectAllRaritySets && (
              <button
                type="button"
                onClick={onSelectAllRaritySets}
                className="min-h-11 px-3 py-1 text-xs rounded-lg bg-[var(--card-bg)] text-[var(--text-secondary)] border border-[var(--card-border)] hover:text-white"
              >
                Select All
              </button>
            )}
            {hasEveryRaritySet && (
              <button
                type="button"
                onClick={onClearRaritySets}
                className="min-h-11 px-3 py-1 text-xs rounded-lg bg-[var(--card-bg)] text-[var(--text-secondary)] border border-[var(--card-border)] hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          {metaTeams.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-[var(--text-secondary)] self-center mr-2">
                  Meta Teams:
                </span>
                {metaTeams.map((team) => (
                  <button
                    key={team}
                    type="button"
                    onClick={() => onToggleMetaTeam(team)}
                    aria-pressed={selectedMetaTeams.has(team)}
                    className={`min-h-11 min-w-11 px-2 py-1 text-xs rounded-full font-medium transition-all border ${getMetaTeamBadgeClasses(team, selectedMetaTeams.has(team))}`}
                  >
                    {team}
                  </button>
                ))}
                {selectedMetaTeams.size > 0 && (
                  <button
                    type="button"
                    onClick={onClearMetaTeams}
                    className="min-h-11 px-3 py-1 text-xs rounded-lg bg-[var(--card-bg)] text-[var(--text-secondary)] border border-[var(--card-border)] hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Native <details>: CSS-only, no client state. */}
              <details className="group">
                <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-white list-none [&::-webkit-details-marker]:hidden">
                  <ChevronDown
                    aria-hidden="true"
                    className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
                  />
                  What do these categories and match types mean?
                </summary>

                <div className="mt-3 space-y-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
                  <div className="space-y-2">
                    {META_TEAM_GLOSSARY.map(({ label, description }) => (
                      <div key={label} className="flex items-center gap-3">
                        <span
                          className={`inline-flex min-w-[92px] flex-shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2 py-1 text-xs font-medium ${getMetaTeamBadgeClasses(label, false)}`}
                        >
                          {label}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">
                          {description}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1 border-t border-[var(--card-border)] pt-2 text-xs text-[var(--text-secondary)]">
                    <p className="font-medium text-[var(--text-primary)]">
                      Match types
                    </p>
                    <p>
                      • <span className="text-green-400">Any</span>: teams with
                      at least one trigger hero
                    </p>
                    <p>
                      • <span className="text-yellow-400">All</span>: teams
                      requiring all specified heroes
                    </p>
                    <p>
                      • <span className="text-red-400">Exact</span>: teams
                      matching exactly the specified composition
                    </p>
                  </div>

                  {UNDESCRIBED_BADGES.length > 0 && (
                    <p className="border-t border-[var(--card-border)] pt-2 text-xs text-[var(--text-secondary)]">
                      Additional auto-classified archetype and leader badges:{' '}
                      {UNDESCRIBED_BADGES.join(', ')}.
                    </p>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Target className="w-4 h-4 text-purple-400" />
        <span>
          Showing {displayBossCount} boss{displayBossCount !== 1 ? 'es' : ''}
          {currentSeason && ` • Season ${currentSeason}`}
          {hasRarityFilter && ` • ${Array.from(selectedRaritySets).join(', ')}`}
          {selectedMetaTeams.size > 0 &&
            ` • ${Array.from(selectedMetaTeams).join(', ')}`}
        </span>
      </div>
    </>
  )
}

'use client'

import type { Dispatch, SetStateAction } from 'react'
import Link from 'next/link'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'
import type { Rarity } from '@/app/lib/config'
import { getMetaTeamBadgeClasses } from '@/app/lib/meta/meta-team-styling'
import {
  META_ANALYSIS_GLOBAL_SCOPE_DETAIL,
  META_ANALYSIS_GLOBAL_SCOPE_NOTICE,
  META_ANALYSIS_MY_GUILD_HREF,
  META_ANALYSIS_MY_GUILD_LINK_LABEL,
  type MetaAnalysisScope
} from '@/app/lib/meta/meta-analysis-scope'

export interface FilterPanelProps {
  /** No guild selector: the endpoints are global, so it would never change the numbers. */
  scope: MetaAnalysisScope | null
  selectedRarities: Rarity[]
  setSelectedRarities: (value: Rarity[]) => void
  availableLevels: string[]
  levelFilter: string
  setLevelFilter: (value: string) => void
  availableMetaTeams: string[]
  selectedMetaTeams: Set<string>
  setSelectedMetaTeams: Dispatch<SetStateAction<Set<string>>>
  recommendedLoading: boolean
  onRefresh: () => void
}

export function FilterPanel({
  scope,
  selectedRarities,
  setSelectedRarities,
  availableLevels,
  levelFilter,
  setLevelFilter,
  availableMetaTeams,
  selectedMetaTeams,
  setSelectedMetaTeams,
  recommendedLoading,
  onRefresh
}: FilterPanelProps) {
  return (
    <div className="card-wh40k p-3 sm:p-4 space-y-3">
      {scope === 'global' && (
        <p
          data-testid="meta-analysis-scope-notice"
          className="text-sm text-secondary-wh40k"
        >
          <span className="font-semibold text-primary-wh40k">
            {META_ANALYSIS_GLOBAL_SCOPE_NOTICE}
          </span>{' '}
          — {META_ANALYSIS_GLOBAL_SCOPE_DETAIL}. For your own guild&apos;s
          compositions, see{' '}
          <Link
            href={META_ANALYSIS_MY_GUILD_HREF}
            className="text-(--accent) underline-offset-4 hover:underline"
          >
            {META_ANALYSIS_MY_GUILD_LINK_LABEL}
          </Link>
          .
        </p>
      )}

      <div className="flex flex-wrap gap-4 items-center">
        <div className="grow">
          <RarityFilterControls
            selectedRarities={selectedRarities}
            onRarityChange={setSelectedRarities}
            availableRarities={[
              'Common',
              'Uncommon',
              'Rare',
              'Epic',
              'Legendary',
              'Mythic'
            ]}
            label="Filter Meta Analysis by Rarity"
          />
        </div>

        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="px-3 py-2 bg-(--card-bg) border border-(--card-border) rounded-lg text-primary-wh40k focus:outline-hidden focus:ring-2 focus:ring-cyan-500"
        >
          <option value="all">All Boss Levels</option>
          {availableLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2 min-h-[32px]">
          {recommendedLoading ? (
            <span className="text-sm text-secondary-wh40k self-center">
              Loading meta teams...
            </span>
          ) : availableMetaTeams.length > 0 ? (
            <>
              <span className="text-sm text-secondary-wh40k self-center">
                Meta Teams:
              </span>
              {availableMetaTeams.map((team) => (
                <button
                  key={team}
                  onClick={() => {
                    setSelectedMetaTeams((prev) => {
                      const newSet = new Set(prev)
                      if (newSet.has(team)) {
                        newSet.delete(team)
                      } else {
                        newSet.add(team)
                      }
                      return newSet
                    })
                  }}
                  className={`px-2 py-1 text-xs rounded-full font-medium transition-all border ${getMetaTeamBadgeClasses(team, selectedMetaTeams.has(team))}`}
                >
                  {team}
                </button>
              ))}
              {selectedMetaTeams.size > 0 && (
                <button
                  onClick={() => setSelectedMetaTeams(new Set())}
                  className="px-3 py-1 text-xs rounded-lg bg-(--card-bg) text-secondary-wh40k border border-(--card-border) hover:bg-(--card-bg)"
                >
                  Clear All
                </button>
              )}
            </>
          ) : (
            <span className="text-sm text-secondary-wh40k self-center">
              No meta teams available
            </span>
          )}
        </div>

        <div className="flex items-end">
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-accent-wh40k hover:bg-[color-mix(in_srgb,var(--accent)_80%,transparent)] text-black rounded-lg transition-colors"
          >
            Refresh Analysis
          </button>
        </div>
      </div>
    </div>
  )
}

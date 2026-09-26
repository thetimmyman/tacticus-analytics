'use client'

import { useState, useMemo } from 'react'
import { Filter, Search } from 'lucide-react'
import { BossCard } from './components/BossCard'
import { SeasonalBossHub } from './components/SeasonalBossHub'
import type { SeasonalBossHubData } from './seasonal-hub-utils'
import type { PlaybooksData, SeasonConfigInfo } from './types'
import {
  buildSeasonCanonicalMap,
  filterBosses,
  sortBossesByName
} from './utils/playbook-helpers'

interface BossPlaybooksClientProps {
  currentSeasonIndex: number
  allSeasons: SeasonConfigInfo[]
  playbooks: PlaybooksData
  seasonalHub: SeasonalBossHubData | null
}

export function BossPlaybooksClient({
  currentSeasonIndex,
  allSeasons,
  playbooks,
  seasonalHub
}: BossPlaybooksClientProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSeason, setSelectedSeason] = useState<string>('all')

  const data = playbooks

  const seasonCanonicalMap = useMemo(
    () => buildSeasonCanonicalMap(allSeasons),
    [allSeasons]
  )

  const filteredBosses = useMemo(() => {
    const result = filterBosses({
      bosses: data.bosses,
      seasonCanonicalMap,
      selectedSeason,
      searchQuery
    })
    return sortBossesByName(result)
  }, [data.bosses, seasonCanonicalMap, searchQuery, selectedSeason])

  return (
    <div className="space-y-6">
      <SeasonalBossHub data={seasonalHub} />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="Search bosses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
          />
        </div>

        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            className="pl-10 pr-8 py-2.5 rounded-lg border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] appearance-none cursor-pointer"
          >
            <option value="all">All Season Configs</option>
            {allSeasons.map((season) => (
              <option key={season.id} value={season.id}>
                Season Config {season.index}
                {season.index === currentSeasonIndex + 1 ? ' (Current)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="text-sm text-[var(--text-tertiary)]">
        Showing {filteredBosses.length} of {data.bosses.length} bosses
        {selectedSeason !== 'all' &&
          ` • Season Config ${allSeasons.find((s) => s.id === selectedSeason)?.index ?? ''}`}
      </div>

      {filteredBosses.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[var(--text-secondary)]">
            No bosses match your search criteria.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredBosses.map((boss) => (
            <BossCard key={boss.id} boss={boss} />
          ))}
        </div>
      )}

      <div className="text-center text-xs text-[var(--text-tertiary)] pt-4 border-t border-[var(--card-border)]">
        Data version {data.version} • Generated {data.generatedAt}
      </div>
    </div>
  )
}

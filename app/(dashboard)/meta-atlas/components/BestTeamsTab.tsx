'use client'

import { LayoutList, Rows3 } from 'lucide-react'
import { DataErrorBoundary } from '@/app/components/error/DataErrorBoundary'
import { MetaAtlasTeamsTab } from './MetaAtlasTeamsTab'
import { TopTeamsTab } from './TopTeamsTab'
import type { MetaFilterControls } from './MetaFilterBar'
import type { BossData, MetaFilters } from '../types'
import type { HeroMapping } from '../utils/hero-mapping'

type HeroMappings = Map<string, HeroMapping>

type GroupedBossEntry = {
  key: string
  raritySet: string
  bossName: string
  bossType: string
  main: BossData | null
  prime1: BossData | null
  prime2: BossData | null
}

export type DensityMode = 'compact' | 'detailed'

// Both densities are global; detailed cards disable the personal toggle and ROI so density
// never triggers private roster requests.
type BestTeamsTabProps = {
  density: DensityMode
  onDensityChange: (density: DensityMode) => void
  filters: MetaFilters | null
  filtersLoading: boolean
  recsLoading: boolean
  heroMappings: HeroMappings
  groupedByRaritySet: GroupedBossEntry[]
  displayBossCount: number
  availableMetaTeams: string[]
  availableRaritySets: string[]
  filterControls: MetaFilterControls
  currentSeason: string
}

export function BestTeamsTab(props: BestTeamsTabProps) {
  const { density, onDensityChange } = props

  const densityButtonClass = (mode: DensityMode) =>
    `flex min-h-11 items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
      density === mode
        ? 'bg-emerald-500 text-black'
        : 'text-secondary-wh40k hover:text-white'
    }`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div
          role="group"
          aria-label="Team detail level"
          className="flex items-center rounded-full border border-(--card-border) bg-card/70 p-1"
        >
          <button
            type="button"
            onClick={() => onDensityChange('compact')}
            aria-pressed={density === 'compact'}
            className={densityButtonClass('compact')}
          >
            <Rows3 aria-hidden="true" className="h-3.5 w-3.5" />
            Compact
          </button>
          <button
            type="button"
            onClick={() => onDensityChange('detailed')}
            aria-pressed={density === 'detailed'}
            className={densityButtonClass('detailed')}
          >
            <LayoutList aria-hidden="true" className="h-3.5 w-3.5" />
            Detailed
          </button>
        </div>
      </div>

      {density === 'compact' ? (
        <DataErrorBoundary fallbackMessage="Failed to load top teams">
          <TopTeamsTab
            filters={props.filters}
            filtersLoading={props.filtersLoading}
            recsLoading={props.recsLoading}
            heroMappings={props.heroMappings}
            groupedByRaritySet={props.groupedByRaritySet}
            displayBossCount={props.displayBossCount}
            availableMetaTeams={props.availableMetaTeams}
            availableRaritySets={props.availableRaritySets}
            filterControls={props.filterControls}
            currentSeason={props.currentSeason}
          />
        </DataErrorBoundary>
      ) : (
        <MetaAtlasTeamsTab
          filters={props.filters}
          filtersLoading={props.filtersLoading}
          recsLoading={props.recsLoading}
          heroMappings={props.heroMappings}
          rosterEntries={[]}
          rosterRoiEntries={[]}
          rosterRoiLoading={false}
          rosterError={null}
          hasRoster={false}
          abilityNotice={null}
          canPersonalize={false}
          currentTeamsLoading={false}
          currentTeamsLookup={{}}
          groupedByRaritySet={props.groupedByRaritySet}
          displayBossCount={props.displayBossCount}
          availableMetaTeams={props.availableMetaTeams}
          availableRaritySets={props.availableRaritySets}
          filterControls={props.filterControls}
          currentSeason={props.currentSeason}
          defaultViewMode="global"
          showViewToggle={false}
          showRosterRoi={false}
        />
      )}
    </div>
  )
}

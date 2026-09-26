'use client'

import { useState } from 'react'
import { Filter } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { StarDisplay } from '@/app/components/StarDisplay'
import { FactionIcon } from './FactionIcon'
import { AllianceIcon } from './AllianceIcon'
import { RankIcon } from './RankIcon'
import { HeroTile } from './HeroTile'
import { HeroDetailSheet } from './HeroDetailSheet'
import { getRarityBorderColor, type UnitRarity } from '../utils/roster-helpers'
import { getPortraitUrl } from '../utils/tile-art'
import type { ProcessedRosterUnit } from '../_lib/process-units'
import type { RosterViewMode, SortField } from '../_lib/roster-constants'
import type { RosterFiltersApi } from '../_lib/useRosterFilters'

function HeroIcon({
  name,
  unitId,
  rarity,
  iconUrl
}: {
  name: string
  unitId: string
  rarity: UnitRarity
  iconUrl: string | null
}) {
  const borderColor = getRarityBorderColor(rarity)
  // Same rectangular art as the tiles, centre-cropped; the round icon is the fallback.
  const artUrl = getPortraitUrl(unitId) ?? iconUrl

  if (artUrl) {
    return (
      <img
        src={artUrl}
        alt={name}
        className={`w-10 h-10 text-xs rounded-lg border-2 flex-shrink-0 object-cover ${borderColor}`}
        loading="lazy"
      />
    )
  }

  return (
    <div
      className={`w-10 h-10 text-xs rounded-lg bg-[var(--bg-secondary)] border-2 flex items-center justify-center text-[var(--text-secondary)] flex-shrink-0 ${borderColor}`}
    >
      {name.slice(0, 2)}
    </div>
  )
}

// Static columns need their own key literals so DataTable keys stay unique.
type RosterColumnKey = SortField | 'stars' | 'rarity' | 'shards' | 'abilities'

interface RosterUnitsViewProps {
  units: ProcessedRosterUnit[]
  totalFilteredCount: number
  viewMode: RosterViewMode
  rf: RosterFiltersApi
}

export function RosterUnitsView({
  units,
  totalFilteredCount,
  viewMode,
  rf
}: RosterUnitsViewProps) {
  const [selectedUnit, setSelectedUnit] = useState<ProcessedRosterUnit | null>(
    null
  )

  // `units` is already the sorted, paginated slice, so DataTable renders it verbatim.
  const columns: DataTableColumn<ProcessedRosterUnit, RosterColumnKey>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (unit) => (
        <div className="flex items-center gap-3">
          <HeroIcon
            name={unit.name}
            unitId={unit.id}
            rarity={unit.rarity}
            iconUrl={unit.iconUrl}
          />
          <div>
            <div className="font-medium text-[var(--text-primary)]">
              {unit.name}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              {unit.id}
            </div>
          </div>
        </div>
      )
    },
    {
      // Left-aligned header over centred cells (`align` would centre both).
      key: 'faction',
      header: 'Faction',
      render: (unit) => (
        <div className="flex justify-center">
          <FactionIcon faction={unit.faction} size="sm" />
        </div>
      )
    },
    {
      key: 'grandAlliance',
      header: 'Alliance',
      render: (unit) => (
        <div className="flex justify-center">
          <AllianceIcon alliance={unit.grandAlliance} size="sm" />
        </div>
      )
    },
    {
      key: 'rank',
      header: 'Rank',
      align: 'center',
      render: (unit) => <RankIcon rank={unit.rank} size="sm" />
    },
    {
      key: 'stars',
      header: 'Stars',
      align: 'center',
      sortable: false,
      render: (unit) => (
        <StarDisplay progressionIndex={unit.progressionIndex} size="sm" />
      )
    },
    {
      key: 'xpLevel',
      header: 'Level',
      align: 'center',
      // DataTable's <td> forces text-secondary; the level cell needs text-primary.
      render: (unit) => (
        <span className="text-[var(--text-primary)]">{unit.xpLevel}</span>
      )
    },
    {
      key: 'rarity',
      header: 'Rarity',
      align: 'center',
      sortable: false,
      render: (unit) => (
        <span className={`text-xs font-medium ${unit.rarityColor}`}>
          {unit.rarity}
        </span>
      )
    },
    {
      key: 'shards',
      header: 'Shards',
      align: 'center',
      sortable: false,
      render: (unit) => (
        <>
          {unit.shards}
          {unit.mythicShards ? (
            <span className="text-red-400 ml-1">+{unit.mythicShards}</span>
          ) : null}
        </>
      )
    },
    {
      key: 'abilities',
      header: 'Abilities',
      align: 'center',
      sortable: false,
      render: (unit) => (
        <span className="text-xs">
          {(unit.abilities ?? []).map((a) => a.level).join(' / ')}
        </span>
      )
    }
  ]

  return (
    <>
      {/* Portrait grid (always on mobile); column counts step up at every breakpoint. */}
      <div
        className={`grid grid-cols-5 gap-1.5 sm:grid-cols-6 sm:gap-2 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-11 ${
          viewMode === 'table' ? 'md:hidden' : ''
        }`}
      >
        {units.map((unit) => (
          <HeroTile
            key={unit.id}
            name={unit.name}
            unitId={unit.id}
            iconUrl={unit.iconUrl}
            rarity={unit.rarity}
            rank={unit.rank}
            xpLevel={unit.xpLevel}
            progressionIndex={unit.progressionIndex}
            shards={unit.shards}
            mythicShards={unit.mythicShards}
            abilities={unit.abilities ?? []}
            onSelect={() => setSelectedUnit(unit)}
          />
        ))}
      </div>

      {/* Desktop Table View */}
      <div
        className={`card-wh40k overflow-hidden hidden ${
          viewMode === 'table' ? 'md:block' : ''
        }`}
      >
        <DataTable
          rows={units}
          columns={columns}
          rowKey={(unit) => unit.id}
          sort={{ key: rf.sortField, direction: rf.sortDirection }}
          onSortChange={(next) => {
            // Unsortable columns never reach onSortChange, so the cast is safe; the hook picks direction.
            rf.handleSort(next.key as SortField)
          }}
          externallySorted
          // The "no matches" message is outside the table; suppress DataTable's EmptyState.
          empty={<></>}
        />
      </div>

      {totalFilteredCount === 0 && (
        <div className="card-wh40k p-8 text-center text-[var(--text-secondary)]">
          <Filter className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No characters match your filters</p>
        </div>
      )}

      <HeroDetailSheet
        unit={selectedUnit}
        onClose={() => setSelectedUnit(null)}
      />
    </>
  )
}

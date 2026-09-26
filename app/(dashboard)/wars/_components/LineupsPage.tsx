'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@tacticus/ui-kit'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@tacticus/ui-kit/select'
import LineupCard from './LineupCard'
import WarPageHeader from './WarPageHeader'
import { useLineupStats } from '../_hooks/useLineupStats'

type Side = 'offense' | 'defense'
type SortOption = 'winRate' | 'uses'

const SIDE_CONFIG: Record<Side, { description: string; winRateLabel: string }> =
  {
    offense: {
      description:
        'Global 5-unit compositions across all tracked wars and the archived community dataset.',
      winRateLabel: 'Win rate'
    },
    defense: {
      description:
        'Global 5-unit compositions across all tracked wars and the archived community dataset.',
      winRateLabel: 'Hold rate'
    }
  }

export default function LineupsPage({ side }: { side: Side }) {
  const [minUses, setMinUses] = useState('3')
  const [sort, setSort] = useState<SortOption>('winRate')
  const [season, setSeason] = useState('recent')
  const [battlefieldLevel, setBattlefieldLevel] = useState('all')

  const {
    data: lineups = [],
    filters,
    isLoading,
    error
  } = useLineupStats(
    side,
    {
      season: season === 'recent' ? null : Number(season),
      battlefieldLevel:
        battlefieldLevel === 'all' ? null : Number(battlefieldLevel)
    },
    Number(minUses)
  )
  const config = SIDE_CONFIG[side]

  const filtered = useMemo(() => {
    const min = parseInt(minUses, 10)
    return lineups.filter((lineup) => lineup.uses >= min)
  }, [lineups, minUses])

  const sorted = useMemo(() => {
    const data = [...filtered]
    if (sort === 'uses') {
      return data.sort((a, b) => b.uses - a.uses)
    }
    return data.sort((a, b) => b.winRate - a.winRate)
  }, [filtered, sort])

  return (
    <div className="px-4 py-6 space-y-6">
      {/* The Offense/Defense toggle lives in LineupsSubnav, so this area has one nav rail. */}
      <WarPageHeader title="Top Lineups" description={config.description} />
      <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
        <CardContent className="p-4 flex flex-wrap gap-3">
          <Select value={season} onValueChange={setSeason}>
            <SelectTrigger className="w-48" aria-label="Season">
              <SelectValue placeholder="Season" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recent 4 seasons</SelectItem>
              {filters.seasons.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  Season {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={battlefieldLevel} onValueChange={setBattlefieldLevel}>
            <SelectTrigger className="w-48" aria-label="Battlefield Tier">
              <SelectValue placeholder="Battlefield Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All battlefield tiers</SelectItem>
              {filters.battlefieldLevels.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  Battlefield Tier {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={minUses} onValueChange={setMinUses}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Min uses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Min 1</SelectItem>
              <SelectItem value="3">Min 3</SelectItem>
              <SelectItem value="5">Min 5</SelectItem>
              <SelectItem value="10">Min 10</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as SortOption)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="winRate">{config.winRateLabel}</SelectItem>
              <SelectItem value="uses">Most used</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {isLoading ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">
          Loading lineup stats...
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-400">
          Failed to load lineup stats
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((lineup) => (
            <LineupCard key={lineup.lineupId} lineup={lineup} />
          ))}
          {sorted.length === 0 && (
            <div className="col-span-full text-center py-12 text-[var(--text-secondary)]">
              No lineups found matching criteria
            </div>
          )}
        </div>
      )}
    </div>
  )
}

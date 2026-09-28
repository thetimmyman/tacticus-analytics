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
import MapsGrid from '@/app/(dashboard)/wars/_components/MapsGrid'
import { useMapStats } from '@/app/(dashboard)/wars/_hooks/useMapStats'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

type SortOption = 'name' | 'attacks' | 'winRate' | 'holdRate'

export default function ZoneTypeStats() {
  const [range, setRange] = useState('30')
  const [sort, setSort] = useState<SortOption>('name')

  const daysBack = range === 'all' ? 9999 : parseInt(range, 10)
  const { data: maps = [], isLoading, error } = useMapStats(daysBack)

  const sortedMaps = useMemo(() => {
    const data = [...maps]
    switch (sort) {
      case 'attacks':
        return data.sort((a, b) => b.offense.attacks - a.offense.attacks)
      case 'winRate':
        return data.sort((a, b) => b.offense.winRate - a.offense.winRate)
      case 'holdRate':
        return data.sort((a, b) => b.defense.holdRate - a.defense.holdRate)
      case 'name':
      default:
        // Sort by the name the card shows, not the raw id.
        return data.sort((a, b) =>
          zoneDisplayName(a.zoneType).localeCompare(zoneDisplayName(b.zoneType))
        )
    }
  }, [maps, sort])

  return (
    <div className="space-y-4">
      <h2 className="subheading-wh40k text-base sm:text-lg">
        Zone Performance
        <span className="ml-2 text-xs font-normal text-secondary-wh40k">
          offense &amp; defense by zone type
        </span>
      </h2>
      <Card className="border-(--border) bg-(--bg-primary)">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as SortOption)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Zone name</SelectItem>
              <SelectItem value="attacks">Most attacked</SelectItem>
              <SelectItem value="winRate">Highest win rate</SelectItem>
              <SelectItem value="holdRate">Highest hold rate</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-(--text-tertiary) flex items-center">
            Range: {range === 'all' ? 'All time' : `${range} days`}
          </div>
        </CardContent>
      </Card>
      {isLoading ? (
        <div className="text-center py-12 text-secondary-wh40k">
          Loading map stats...
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-400">
          Failed to load map stats
        </div>
      ) : (
        <MapsGrid maps={sortedMaps} />
      )}
    </div>
  )
}

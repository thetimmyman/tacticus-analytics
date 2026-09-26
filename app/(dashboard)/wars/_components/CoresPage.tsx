'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import CoreCard from './CoreCard'
import SideTogglePills from './SideTogglePills'
import WarPageHeader from './WarPageHeader'
import { useCoreCompositions } from '../_hooks'
import type { CoreSize } from '../_hooks/useCoreCompositions'
import { useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@tacticus/ui-kit/select'

type Side = 'offense' | 'defense'
type SortOption = 'uses' | 'winRate'

const SIDE_CONFIG: Record<Side, { cardTitle: string }> = {
  offense: { cardTitle: 'Top Offensive Cores' },
  defense: { cardTitle: 'Top Defensive Cores' }
}

export default function CoresPage({ side }: { side: Side }) {
  const [sort, setSort] = useState<SortOption>('uses')
  const [season, setSeason] = useState('recent')
  const [battlefieldLevel, setBattlefieldLevel] = useState('all')
  const [coreSize, setCoreSize] = useState<CoreSize>(3)
  const {
    data: cores = [],
    filters,
    isLoading,
    error
  } = useCoreCompositions(
    side,
    {
      season: season === 'recent' ? null : Number(season),
      battlefieldLevel:
        battlefieldLevel === 'all' ? null : Number(battlefieldLevel)
    },
    coreSize
  )

  const config = SIDE_CONFIG[side]

  const sorted = useMemo(() => {
    const data = [...cores]
    if (sort === 'winRate') return data.sort((a, b) => b.winRate - a.winRate)
    return data.sort((a, b) => b.totalUses - a.totalUses)
  }, [cores, sort])

  return (
    <div className="px-4 py-6 space-y-6">
      <WarPageHeader
        title="Cores and Flex"
        description="Global 3-hero cores and pair synergies across all tracked wars, with archived community data included for canonical cores."
      />
      <SideTogglePills active={side} basePath="/wars/cores" />
      <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
        <CardContent className="p-4 flex flex-wrap gap-3">
          <Select
            value={String(coreSize)}
            onValueChange={(value) => setCoreSize(Number(value) as CoreSize)}
          >
            <SelectTrigger className="w-52" aria-label="Core size">
              <SelectValue placeholder="Core size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 heroes (Core)</SelectItem>
              <SelectItem value="2">2 heroes (Pair synergy)</SelectItem>
            </SelectContent>
          </Select>
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
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as SortOption)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="uses">Most used</SelectItem>
              <SelectItem value="winRate">Win rate</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
        <CardHeader className="pb-2">
          <CardTitle>{config.cardTitle}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="text-center py-12 text-[var(--text-secondary)]">
              Loading core compositions...
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">
              Failed to load core compositions
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((core) => (
                <CoreCard key={core.coreId} core={core} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

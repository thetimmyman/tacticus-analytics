import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useHeroCatalog } from '@/app/lib/catalogs'
import {
  extractBadge,
  resolveHeroPortrait
} from '@/app/lib/catalogs/hero-portrait-resolver'
import type { CoreComposition, Unit } from '../_types'
import {
  appendWarMetaSelection,
  EMPTY_WAR_META_FILTERS,
  type WarMetaFilters,
  type WarMetaSelection
} from './warMetaFilters'

type CoreCompositionRow = {
  core_id: string
  core_heroes: string[]
  core_size: number
  total_uses: number
  wins: number
  win_rate: number
  flex_options: Array<{
    heroKey: string
    uses: string
    frequency: string
    winRate: string
  }>
}

export type CoreSize = 2 | 3

function heroKeyToUnit(heroKey: string): Unit {
  return {
    id: heroKey,
    name: heroKey,
    shortCode: extractBadge(heroKey),
    portraitUrl: undefined
  }
}

function transformCoreRow(row: CoreCompositionRow): CoreComposition {
  return {
    coreId: row.core_id,
    coreUnits: row.core_heroes.map(heroKeyToUnit),
    coreSize: row.core_size,
    totalUses: Number(row.total_uses),
    wins: Number(row.wins),
    winRate: Number(row.win_rate),
    flexOptions: (row.flex_options || []).map((flex) => ({
      unit: heroKeyToUnit(flex.heroKey),
      frequency: Number(flex.frequency),
      winRateWithCore: Number(flex.winRate),
      uses: Number(flex.uses)
    }))
  }
}

async function fetchCoreCompositions(
  side: 'offense' | 'defense',
  selection: WarMetaSelection,
  coreSize: CoreSize
): Promise<{ cores: CoreComposition[]; filters: WarMetaFilters }> {
  const params = new URLSearchParams({ side })
  appendWarMetaSelection(params, selection)
  params.set('core_size', String(coreSize))
  const res = await fetch(`/api/wars/analytics/cores?${params}`)
  if (!res.ok) {
    throw new Error('Failed to fetch core compositions')
  }
  const data = await res.json()
  return {
    cores: (data.cores || []).map(transformCoreRow),
    filters: data.filters || EMPTY_WAR_META_FILTERS
  }
}

export function useCoreCompositions(
  side: 'offense' | 'defense',
  selection: WarMetaSelection,
  coreSize: CoreSize
) {
  const { data: heroCatalog } = useHeroCatalog()
  const query = useQuery({
    queryKey: [
      'coreCompositions',
      side,
      selection.season,
      selection.battlefieldLevel,
      coreSize
    ],
    queryFn: () => fetchCoreCompositions(side, selection, coreSize),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  const data = useMemo(() => {
    if (!query.data) return undefined
    const enrichUnit = (unit: Unit): Unit => {
      const { portraitUrl, displayName } = resolveHeroPortrait(
        unit.id,
        heroCatalog
      )
      return {
        ...unit,
        name: displayName,
        portraitUrl: portraitUrl || unit.portraitUrl
      }
    }
    return query.data.cores.map((core) => ({
      ...core,
      coreUnits: core.coreUnits.map(enrichUnit),
      flexOptions: core.flexOptions.map((flex) => ({
        ...flex,
        unit: enrichUnit(flex.unit)
      }))
    }))
  }, [query.data, heroCatalog])

  return {
    ...query,
    data,
    filters: query.data?.filters ?? EMPTY_WAR_META_FILTERS
  }
}

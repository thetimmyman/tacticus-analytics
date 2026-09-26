import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useHeroCatalog } from '@/app/lib/catalogs'
import {
  extractBadge,
  resolveHeroPortrait
} from '@/app/lib/catalogs/hero-portrait-resolver'
import type { LineupStats, LineupStatsRow, Unit } from '../_types'
import {
  appendWarMetaSelection,
  EMPTY_WAR_META_FILTERS,
  type WarMetaFilters,
  type WarMetaSelection
} from './warMetaFilters'

function parseUnitsFromJson(unitsJson: unknown): Unit[] {
  if (!unitsJson || !Array.isArray(unitsJson)) return []

  return unitsJson.map(
    (unit: { heroKey?: string; unitId?: string; name?: string }) => {
      const heroKey = unit.heroKey || unit.unitId || ''
      const name = unit.name || heroKey
      return {
        id: heroKey,
        name,
        shortCode: extractBadge(name),
        portraitUrl: undefined
      }
    }
  )
}

function transformLineupRow(row: LineupStatsRow): LineupStats {
  return {
    lineupId: row.lineup_id,
    units: parseUnitsFromJson(row.units_json),
    uses: Number(row.uses),
    wins: Number(row.wins),
    losses: Number(row.losses),
    winRate: Number(row.win_rate)
  }
}

async function fetchLineupStats(
  side: 'offense' | 'defense',
  selection: WarMetaSelection,
  minUses: number
): Promise<{ lineups: LineupStats[]; filters: WarMetaFilters }> {
  const params = new URLSearchParams({ side })
  appendWarMetaSelection(params, selection)
  params.set('min_uses', String(minUses))
  const res = await fetch(`/api/wars/analytics/lineups?${params}`)
  if (!res.ok) {
    throw new Error('Failed to fetch lineup stats')
  }
  const data = await res.json()
  return {
    lineups: (data.lineups || []).map(transformLineupRow),
    filters: data.filters || EMPTY_WAR_META_FILTERS
  }
}

export function useLineupStats(
  side: 'offense' | 'defense',
  selection: WarMetaSelection,
  minUses: number
) {
  const { data: heroCatalog } = useHeroCatalog()
  const query = useQuery({
    queryKey: [
      'lineupStats',
      side,
      selection.season,
      selection.battlefieldLevel,
      minUses
    ],
    queryFn: () => fetchLineupStats(side, selection, minUses),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  const data = useMemo(() => {
    if (!query.data) return query.data
    return query.data.lineups.map((lineup) => ({
      ...lineup,
      units: lineup.units.map((unit) => {
        const resolved = resolveHeroPortrait(unit.id, heroCatalog)
        return {
          ...unit,
          name: resolved.hero ? resolved.displayName : unit.name,
          portraitUrl: resolved.portraitUrl || unit.portraitUrl
        }
      })
    }))
  }, [query.data, heroCatalog])

  return {
    ...query,
    data,
    filters: query.data?.filters ?? EMPTY_WAR_META_FILTERS
  }
}

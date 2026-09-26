import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useHeroCatalog } from '@/app/lib/catalogs'
import {
  extractBadge,
  resolveHeroPortrait
} from '@/app/lib/catalogs/hero-portrait-resolver'
import type { UnitPerformance, HeroPerformanceRow, Unit } from '../_types'

function heroKeyToUnit(heroKey: string): Unit {
  return {
    id: heroKey,
    name: heroKey,
    shortCode: extractBadge(heroKey),
    portraitUrl: undefined
  }
}

function transformHeroRow(row: HeroPerformanceRow): UnitPerformance {
  return {
    unit: heroKeyToUnit(row.hero_key),
    uses: Number(row.uses),
    wins: Number(row.wins),
    losses: Number(row.losses),
    winRate: Number(row.win_rate),
    avgScore: Number(row.avg_score),
    avgKills: Number(row.avg_kills)
  }
}

async function fetchHeroPerformance(
  side: 'offense' | 'defense'
): Promise<UnitPerformance[]> {
  const res = await fetch(`/api/wars/analytics/performance?side=${side}`)
  if (!res.ok) {
    throw new Error('Failed to fetch hero performance')
  }
  const data = await res.json()
  return (data.heroes || []).map(transformHeroRow)
}

export function useHeroPerformance(side: 'offense' | 'defense') {
  const { data: heroCatalog } = useHeroCatalog()
  const query = useQuery({
    queryKey: ['heroPerformance', side],
    queryFn: () => fetchHeroPerformance(side),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  const data = useMemo(() => {
    if (!query.data) return query.data
    return query.data.map((item) => {
      const { portraitUrl, displayName } = resolveHeroPortrait(
        item.unit.id,
        heroCatalog
      )
      return {
        ...item,
        unit: {
          ...item.unit,
          name: displayName,
          portraitUrl: portraitUrl || item.unit.portraitUrl
        }
      }
    })
  }, [query.data, heroCatalog])

  return { ...query, data }
}

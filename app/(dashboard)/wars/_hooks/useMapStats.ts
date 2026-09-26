import { useQuery } from '@tanstack/react-query'
import type { MapStats } from '../_types'

/** `zone_display_name` (INITCAP) and `map_code` are deliberately unmodelled. */
type ZoneStatsRow = {
  zone_type: string
  offense_attacks: number
  offense_wins: number
  offense_win_rate: number
  offense_avg_score: number
  defense_attacks: number
  defense_holds: number
  defense_hold_rate: number
  defense_avg_conceded: number
}

function transformZoneRow(row: ZoneStatsRow): MapStats {
  return {
    // `zoneDisplayName` is not idempotent, so format only at render.
    zoneType: row.zone_type,
    offense: {
      attacks: Number(row.offense_attacks),
      wins: Number(row.offense_wins),
      winRate: Number(row.offense_win_rate),
      avgScore: Number(row.offense_avg_score)
    },
    defense: {
      defends: Number(row.defense_attacks),
      holds: Number(row.defense_holds),
      holdRate: Number(row.defense_hold_rate),
      avgScoreConceded: Number(row.defense_avg_conceded)
    }
  }
}

async function fetchMapStats(daysBack: number): Promise<MapStats[]> {
  const res = await fetch(`/api/wars/analytics/maps?days=${daysBack}`)
  if (!res.ok) {
    throw new Error('Failed to fetch map stats')
  }
  const json = await res.json()
  const rows: ZoneStatsRow[] = json.maps || []
  return rows.map(transformZoneRow)
}

export function useMapStats(daysBack: number = 30) {
  return useQuery({
    queryKey: ['mapStats', daysBack],
    queryFn: () => fetchMapStats(daysBack),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

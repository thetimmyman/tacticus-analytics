'use client'

import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import { buildActiveWarVisibilityFilter } from '@/app/lib/war/active-wars'
import { calculateWarStats, type WarMatch } from './war-reports-model'

const MATCH_COLUMNS =
  'id, war_id, opponent_guild_code, opponent_guild_name, war_status, guild_score, opponent_score, war_result, war_start_date, war_end_date, war_season, battlefield_level, raw_loki_data'

async function fetchWarReportsData(guildCode: string) {
  const supabase = dbClient()
  const activeWarFilter = buildActiveWarVisibilityFilter()
  const { data: activeData, error: activeError } = await supabase
    .from('guild_war_matches')
    .select(MATCH_COLUMNS)
    .eq('guild_code', guildCode)
    .eq('war_status', 'active')
    .or(activeWarFilter)
    .not('opponent_guild_name', 'is', null)
    .neq('opponent_guild_name', '')
    .neq('opponent_guild_name', 'Unknown Opponent')
    .order('war_start_date', { ascending: false })
    .limit(5)
  if (activeError) {
    throw new Error(`Failed to fetch active matches: ${activeError.message}`)
  }

  // Unfiltered so the countdown detects prep before the opponent resolves.
  let phaseMatch: WarMatch | null = null
  if (!activeData || activeData.length === 0) {
    const { data } = await supabase
      .from('guild_war_matches')
      .select(MATCH_COLUMNS)
      .eq('guild_code', guildCode)
      .eq('war_status', 'active')
      .or(activeWarFilter)
      .order('war_start_date', { ascending: false })
      .limit(1)
    phaseMatch = (data as unknown as WarMatch[] | null)?.[0] ?? null
  }

  const { data: completedData, error: completedError } = await supabase
    .from('guild_war_matches')
    .select(MATCH_COLUMNS)
    .eq('guild_code', guildCode)
    .eq('war_status', 'completed')
    .order('war_end_date', { ascending: false })
  if (completedError) {
    throw new Error(`Failed to fetch all matches: ${completedError.message}`)
  }

  const activeMatches = (activeData as unknown as WarMatch[] | null) ?? []
  const allMatches = (completedData as unknown as WarMatch[] | null) ?? []
  return {
    activeMatches,
    phaseMatch,
    allMatches,
    warStats: calculateWarStats(allMatches)
  }
}

export function useWarReportsData(guildCode: string) {
  return useQuery({
    queryKey: ['warDashboard', guildCode],
    queryFn: () => fetchWarReportsData(guildCode),
    enabled: !!guildCode,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
  })
}

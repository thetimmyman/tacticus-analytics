import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export type ClusterLeaderboardRow = {
  stable_key: string
  display_name: string
  guild: string
  user_id: string | null
  total_damage: number
  battle_count: number
  avg_damage: number
  bombs_used: number
  bosses_killed: number
  all_battle_count: number
  all_bosses_killed: number
  percent_vs_cluster: number | null
  current_rank: number
}

export type HistoricalRankingRow = {
  season: string
  stable_key: string
  display_name: string
  guild: string
  percent_vs_cluster: number | null
  season_rank: number
}

export async function getClusterOverallLeaderboardRPC(
  supabase: TypedSupabaseClient,
  filters: { Season: string; clusterCode?: string }
): Promise<ClusterLeaderboardRow[]> {
  const { data, error } = (await supabase.rpc(
    'get_cluster_overall_leaderboard',
    {
      p_season: filters.Season,
      p_cluster_code: filters.clusterCode ?? undefined
    }
  )) as unknown as { data: ClusterLeaderboardRow[] | null; error: Error | null }

  if (error) {
    throw error
  }

  return data ?? []
}

export async function getClusterHistoricalRankingsRPC(
  supabase: TypedSupabaseClient,
  filters: { seasons: string[]; clusterCode?: string }
): Promise<HistoricalRankingRow[]> {
  const { data, error } = (await supabase.rpc(
    'get_cluster_historical_rankings',
    {
      p_seasons: filters.seasons,
      p_cluster_code: filters.clusterCode ?? undefined
    }
  )) as unknown as { data: HistoricalRankingRow[] | null; error: Error | null }

  if (error) {
    throw error
  }

  return data ?? []
}

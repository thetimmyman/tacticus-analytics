import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export type GuildTrendsRow = {
  season: string
  total_damage: number
  total_battles: number
  max_hit: number
  boss_kills: number
  active_players: number
  guild_member_count: number
  participation_rate: number | null
  avg_damage_per_token: number | null
  vs_cluster_percent: number | null
  guild_rank_in_cluster: number | null
  total_guilds_in_cluster: number | null
  reliability_score: number | null
}

export async function getGuildTrendsBatchRPC(
  supabase: TypedSupabaseClient,
  filters: { guild_code: string; seasons: string[] }
): Promise<GuildTrendsRow[]> {
  const { data, error } = await supabase.rpc('get_guild_trends_batch', {
    p_guild_code: filters.guild_code,
    p_seasons: filters.seasons
  })

  if (error) {
    throw error
  }

  return data ?? []
}

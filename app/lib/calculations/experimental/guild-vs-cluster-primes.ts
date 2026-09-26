import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export type GuildVsClusterPrimeRow = {
  prime_name: string
  guild_avg_damage: number | null
  cluster_avg_damage: number | null
  vs_cluster_percent: number | null
  set: number | null
  rarity: string | null
}

export async function getGuildVsClusterPrimePerformanceRPC(
  supabase: TypedSupabaseClient,
  filters: { Guild: string; Season: string }
): Promise<GuildVsClusterPrimeRow[]> {
  const { data, error } = (await supabase.rpc(
    'get_guild_vs_cluster_prime_performance',
    {
      p_guild_code: filters.Guild,
      p_season: filters.Season
    }
  )) as unknown as {
    data: GuildVsClusterPrimeRow[] | null
    error: Error | null
  }

  if (error) {
    throw error
  }

  return data ?? []
}

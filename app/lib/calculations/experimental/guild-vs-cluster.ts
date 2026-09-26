import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export type GuildVsClusterBossRow = {
  boss_name: string
  encounter_type: string
  guild_avg_damage: number | null
  cluster_avg_damage: number | null
  vs_cluster_percent: number | null
  set: number | null
  rarity: string | null
}

export async function getGuildVsClusterBossPerformanceRPC(
  supabase: TypedSupabaseClient,
  filters: { Guild: string; Season: string; rarities?: string[] }
): Promise<GuildVsClusterBossRow[]> {
  const rpcParams: Record<string, unknown> = {
    p_guild_code: filters.Guild,
    p_season: filters.Season
  }
  if (filters.rarities && filters.rarities.length > 0) {
    rpcParams.p_rarities = filters.rarities
  }
  const { data, error } = (await supabase.rpc(
    'get_guild_vs_cluster_boss_performance',
    rpcParams as {
      p_guild_code: string
      p_season: string
      p_rarities?: string[]
    }
  )) as unknown as { data: GuildVsClusterBossRow[] | null; error: Error | null }

  if (error) {
    throw error
  }

  return data ?? []
}

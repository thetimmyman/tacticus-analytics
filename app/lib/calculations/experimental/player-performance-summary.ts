import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { PerformanceSummary } from '@tacticus/app-core/performance.types'

type RpcRow = {
  user_id: string
  display_name: string
  avg_vs_cluster: number | null
  avg_vs_guild: number | null
  avg_vs_cluster_boss_only: number | null
  avg_vs_guild_boss_only: number | null
  bosses_played: number | null
  boss_hits: number | null
  prime_hits: number | null
  primes_played: number | null
  total_battles: number | null
}

export type PlayerPerformanceSummaryRow = PerformanceSummary

export async function getPlayerPerformanceSummaryRPC(
  supabase: TypedSupabaseClient,
  filters: { Guild: string; Season: string; rarities?: string[] }
): Promise<PerformanceSummary[]> {
  const rpcParams: Record<string, unknown> = {
    p_guild_code: filters.Guild,
    p_season: filters.Season
  }
  if (filters.rarities && filters.rarities.length > 0) {
    rpcParams.p_rarities = filters.rarities
  }
  const { data, error } = (await supabase.rpc(
    'get_player_performance_summary',
    rpcParams as {
      p_guild_code: string
      p_season: string
      p_rarities?: string[]
    }
  )) as unknown as { data: RpcRow[] | null; error: Error | null }

  if (error) {
    throw error
  }

  return (data ?? []).map((row) => ({
    playerId: row.user_id,
    displayName: row.display_name,
    avg_vs_cluster: row.avg_vs_cluster ?? 0,
    avg_vs_guild: row.avg_vs_guild ?? 0,
    avg_vs_cluster_boss_only: row.avg_vs_cluster_boss_only ?? 0,
    avg_vs_guild_boss_only: row.avg_vs_guild_boss_only ?? 0,
    bosses_played: row.bosses_played ?? 0,
    boss_hits: row.boss_hits ?? 0,
    prime_hits: row.prime_hits ?? 0,
    primes_played: row.primes_played ?? 0,
    total_battles: row.total_battles ?? 0
  }))
}

export interface PerformanceSummary {
  displayName: string
  playerId?: string
  avg_vs_cluster: number
  avg_vs_guild: number
  avg_vs_cluster_boss_only: number
  avg_vs_guild_boss_only: number
  total_battles: number
  bosses_played: number
  primes_played: number
  boss_hits: number
  prime_hits: number
  isActive?: boolean
}

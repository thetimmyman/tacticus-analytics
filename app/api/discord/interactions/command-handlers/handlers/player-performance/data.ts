import type { Supabase } from '../../types'
import type { PerformanceSummary } from '@tacticus/app-core/performance.types'
import { normalizeRpcRow } from '@/app/lib/calculations/experimental/player-boss-performance'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

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

export type FetchGuildPerformanceResult =
  | { ok: true; summaries: PerformanceSummary[]; guild: string; season: string }
  | { ok: false; message: string }

export async function fetchGuildPerformanceSummary(
  supabase: Supabase,
  { guild, season }: { guild: string; season: string }
): Promise<FetchGuildPerformanceResult> {
  const { data, error } = (await supabase.rpc(
    'get_player_performance_summary',
    {
      p_guild_code: guild,
      p_season: season
    }
  )) as { data: RpcRow[] | null; error: Error | null }

  if (error) {
    return {
      ok: false,
      message: `Failed to load performance data: ${error.message}`
    }
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      message: `No performance data found for guild ${guild} in season ${season}.`
    }
  }

  const summaries: PerformanceSummary[] = data.map((row) => ({
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

  return { ok: true, summaries, guild, season }
}

export type PlayerBossRow = {
  boss_name: string
  vs_guild_pct: number
  vs_cluster_pct: number
  battle_count: number
  set: number | null
  rarity: string | null
}

export type FetchPlayerRadarResult =
  | {
      ok: true
      rows: PlayerBossRow[]
      playerName: string
      guild: string
      season: string
      hasCluster: boolean
    }
  | { ok: false; message: string }

export async function fetchPlayerRadarData(
  supabase: Supabase,
  {
    guild,
    season,
    playerName
  }: { guild: string; season: string; playerName: string }
): Promise<FetchPlayerRadarResult> {
  // playerName stays raw as the RPC lookup key.
  const memberLabels = await getMemberLabelMap()

  const [bossResult, primeResult] = await Promise.all([
    supabase.rpc('get_player_boss_performance', {
      p_guild_code: guild,
      p_season: season,
      p_display_name: playerName
    }) as unknown as Promise<{
      data: Record<string, unknown>[] | null
      error: Error | null
    }>,
    supabase
      .rpc('get_player_prime_performance', {
        guild_code_param: guild,
        season_param: season
      })
      .then(
        (r) =>
          r as unknown as {
            data: Record<string, unknown>[] | null
            error: Error | null
          },
        () => ({ data: [] as Record<string, unknown>[], error: null })
      )
  ])

  const { data, error } = bossResult
  const primeData = Array.isArray(primeResult.data) ? primeResult.data : []

  if (error && primeData.length === 0) {
    return {
      ok: false,
      message: `Failed to load boss performance: ${error.message}`
    }
  }

  // Boss rows are filtered server-side; only the unscoped prime RPC needs the name filter.
  const target = playerName.toLowerCase()
  const scopedPrimeRows = primeData.filter((row) => {
    const n = normalizeRpcRow(row)
    const dn = n.displayName.toLowerCase()
    return dn === target || !dn // include rows without displayName (guild-wide primes)
  })
  const allRows = [...(Array.isArray(data) ? data : []), ...scopedPrimeRows]

  if (allRows.length === 0) {
    return {
      ok: false,
      message: `No performance data found for ${resolveMemberLabel(playerName, memberLabels)} in guild ${guild}.`
    }
  }

  const rows: PlayerBossRow[] = allRows
    .map((row) => {
      const n = normalizeRpcRow(row)
      return {
        boss_name: n.boss_name,
        vs_guild_pct: n.vs_guild_pct ?? 0,
        vs_cluster_pct: n.vs_cluster_pct ?? 0,
        battle_count: n.battle_count ?? 0,
        set: n.set,
        rarity: n.rarity
      }
    })
    .filter((r) => r.boss_name && r.battle_count > 0)

  if (rows.length === 0) {
    return {
      ok: false,
      message: `No boss data found for ${resolveMemberLabel(playerName, memberLabels)} in guild ${guild}.`
    }
  }

  const hasCluster = rows.some((r) => r.vs_cluster_pct !== 0)

  return { ok: true, rows, playerName, guild, season, hasCluster }
}

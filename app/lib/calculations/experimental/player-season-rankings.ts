import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  applyTokenWeightingPercent,
  clampTokenRatio
} from '@tacticus/app-core/token-weighting'

/** Cell = signed % vs that season's guild average; AVG is a simple mean of present cells. */

export type RosterScope = 'current' | 'all'

export interface LongScoreRow {
  season: string
  userId: string
  vsGuild: number
}

export interface GuildPlayerScoreRow {
  season: string
  user_id: string
  weighted_vs_guild: number
  battle_count: number
}

export interface SeasonTokenStatsBatchRow {
  season: string
  user_id: string
  display_name: string | null
  tokens_spent: number
  tokens_possible: number
}

export interface TargetScoreRow {
  season: string
  user_id: string
  weighted_score: number | null
}

export interface PlayerNameStatus {
  displayName: string
  isCurrent: boolean
}

export interface PlayerSeasonRankingRow {
  /** player_mapping.player_id, NOT the auth UID. */
  playerId: string
  displayName: string
  isCurrent: boolean
  cellsBySeason: Record<string, number | null>
  avg: number | null
  seasonsPlayed: number
}

export interface PlayerSeasonRankingsResult {
  seasons: string[]
  rows: PlayerSeasonRankingRow[]
}

const seasonUserKey = (season: string, userId: string) => `${season}::${userId}`

export async function getGuildPlayerScoresBatchRPC(
  supabase: TypedSupabaseClient,
  filters: { guild_code: string; seasons: string[] }
): Promise<GuildPlayerScoreRow[]> {
  const { data, error } = await supabase.rpc('get_guild_player_scores_batch', {
    p_guild_code: filters.guild_code,
    p_seasons: filters.seasons
  })
  if (error) throw error
  return (data as GuildPlayerScoreRow[] | null) ?? []
}

export async function getSeasonTokenStatsBatchRPC(
  supabase: TypedSupabaseClient,
  filters: { guild_code: string; seasons: string[] }
): Promise<SeasonTokenStatsBatchRow[]> {
  const { data, error } = await supabase.rpc('get_season_token_stats_batch', {
    p_guild_code: filters.guild_code,
    p_seasons: filters.seasons
  })
  if (error) throw error
  return (data as SeasonTokenStatsBatchRow[] | null) ?? []
}

export function battleRowsToLong(rows: GuildPlayerScoreRow[]): LongScoreRow[] {
  const out: LongScoreRow[] = []
  for (const r of rows) {
    if (!r.user_id || r.weighted_vs_guild == null) continue
    out.push({
      season: String(r.season),
      userId: r.user_id,
      vsGuild: r.weighted_vs_guild
    })
  }
  return out
}

/** A player missing a token row keeps ratio 1 rather than dropping out. */
export function applyTokenRatios(
  battleLong: LongScoreRow[],
  tokenRows: SeasonTokenStatsBatchRow[]
): LongScoreRow[] {
  const ratioByKey = new Map<string, number>()
  for (const t of tokenRows) {
    if (!t.user_id) continue
    const ratio =
      t.tokens_possible > 0
        ? clampTokenRatio(t.tokens_spent / t.tokens_possible)
        : t.tokens_spent > 0
          ? 1
          : 0
    ratioByKey.set(seasonUserKey(String(t.season), t.user_id), ratio)
  }
  return battleLong.map((row) => {
    const ratio = ratioByKey.get(seasonUserKey(row.season, row.userId)) ?? 1
    return {
      season: row.season,
      userId: row.userId,
      vsGuild: applyTokenWeightingPercent(row.vsGuild, ratio)
    }
  })
}

/** Null scores become absent cells so they do not skew the mean. */
export function targetRowsToLong(rows: TargetScoreRow[]): LongScoreRow[] {
  const out: LongScoreRow[] = []
  for (const r of rows) {
    if (!r.user_id || r.weighted_score == null) continue
    out.push({
      season: String(r.season),
      userId: r.user_id,
      vsGuild: (r.weighted_score - 1) * 100
    })
  }
  return out
}

export function buildResult(
  long: LongScoreRow[],
  nameStatus: Map<string, PlayerNameStatus>,
  seasons: string[]
): PlayerSeasonRankingsResult {
  const byPlayer = new Map<string, Map<string, number>>()
  for (const { season, userId, vsGuild } of long) {
    if (!Number.isFinite(vsGuild)) continue
    let seasonMap = byPlayer.get(userId)
    if (!seasonMap) {
      seasonMap = new Map<string, number>()
      byPlayer.set(userId, seasonMap)
    }
    seasonMap.set(season, vsGuild)
  }

  const rows: PlayerSeasonRankingRow[] = []
  for (const [userId, seasonMap] of byPlayer) {
    const cellsBySeason: Record<string, number | null> = {}
    let sum = 0
    let n = 0
    for (const s of seasons) {
      const v = seasonMap.get(s)
      if (v === undefined) {
        cellsBySeason[s] = null
      } else {
        cellsBySeason[s] = v
        sum += v
        n += 1
      }
    }
    const meta = nameStatus.get(userId)
    rows.push({
      playerId: userId,
      displayName: meta?.displayName ?? userId,
      isCurrent: meta?.isCurrent ?? false,
      cellsBySeason,
      avg: n > 0 ? sum / n : null,
      seasonsPlayed: n
    })
  }

  rows.sort((a, b) => {
    if (a.avg === null && b.avg === null) return 0
    if (a.avg === null) return 1
    if (b.avg === null) return -1
    return b.avg - a.avg
  })

  return { seasons, rows }
}

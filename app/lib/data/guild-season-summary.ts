import { db } from '@/app/lib/db'

export interface GuildSeasonSummary {
  total_damage: number
  total_battles: number
  max_hit: number
  boss_kills: number
  recent_activity: number
  avg_damage_per_hour: number | null
}

interface GuildSeasonSummaryRPCRow {
  total_damage?: number | null
  total_battles?: number | null
  max_hit?: number | null
  boss_kills?: number | null
  recent_activity?: number | null
  avg_damage_per_hour?: number | null
}

export async function getGuildSeasonSummary(
  guild: string,
  season: string
): Promise<GuildSeasonSummary> {
  if (!guild || !season) {
    throw new Error('Guild and season are required')
  }

  const supabase = await db()
  const { data, error } = (await supabase.rpc('get_guild_season_summary', {
    p_guild_code: guild,
    p_season: season
  })) as { data: GuildSeasonSummaryRPCRow[] | null; error: Error | null }

  if (error) {
    throw error
  }

  const row = Array.isArray(data) && data[0] ? data[0] : {}
  return {
    total_damage: Number(row.total_damage ?? 0),
    total_battles: Number(row.total_battles ?? 0),
    max_hit: Number(row.max_hit ?? 0),
    boss_kills: Number(row.boss_kills ?? 0),
    recent_activity: Number(row.recent_activity ?? 0),
    avg_damage_per_hour:
      row.avg_damage_per_hour === null || row.avg_damage_per_hour === undefined
        ? null
        : Number(row.avg_damage_per_hour)
  }
}

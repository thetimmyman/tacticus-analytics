import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'

export interface GuildBossAverage {
  boss_name: string
  encounter_id: number
  set_num: number
  rarity: string
  avg_damage: number
  hit_count: number
}

/** Keyed by "${boss_name}_${rarity}_${set}". */
export type GuildBossAveragesMap = Map<string, GuildBossAverage>

function buildBossKey(
  bossName: string,
  rarity: string,
  setNum?: number
): string {
  return `${bossName}_${rarity}_${setNum ?? 0}`
}

export function useGuildBossAverages(
  guildCode: string,
  season: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['guild-boss-averages', guildCode, season],
    queryFn: async (): Promise<GuildBossAveragesMap> => {
      const supabase = dbClient()
      const { data, error } = await supabase.rpc('get_guild_boss_averages', {
        p_guild_code: guildCode,
        p_season: season
      })
      if (error) throw error

      const map: GuildBossAveragesMap = new Map()
      if (Array.isArray(data)) {
        for (const row of data) {
          const key = buildBossKey(row.boss_name, row.rarity, row.set_num)
          // Duplicate encounter_ids: prefer encounter 0 (main), else the highest hit_count.
          const existing = map.get(key)
          if (
            !existing ||
            row.encounter_id === 0 ||
            row.hit_count > existing.hit_count
          ) {
            map.set(key, {
              boss_name: row.boss_name,
              encounter_id: row.encounter_id,
              set_num: row.set_num,
              rarity: row.rarity,
              avg_damage: Number(row.avg_damage) || 0,
              hit_count: Number(row.hit_count) || 0
            })
          }
        }
      }
      return map
    },
    enabled: options?.enabled ?? (!!guildCode && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

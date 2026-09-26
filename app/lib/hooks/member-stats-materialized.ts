import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'

export interface MemberStatsSummary {
  display_name: string
  guild_code: string
  role: 'member' | 'officer' | 'leader'
  player_id: string
  is_current: boolean
  theme_preference: string | null
  primary_boss: string | null
  secondary_boss: string | null
  last_profile_update: string

  total_damage: number
  battle_count: number
  bomb_count: number
  tokens_used: number
  average_damage: number
  max_damage: number
  last_active: string

  token_status: 'normal' | 'offender' | 'abuser'

  legendary_battles: number
  unique_bosses_fought: number
  battles_last_7_days: number

  token_offender_threshold: number
  token_abuser_threshold: number
  config_guild_code: string
}

export const memberStatsKeys = {
  all: ['member-stats-materialized'] as const,
  guild: (guild: string) => ['member-stats-materialized', guild] as const,
  player: (guild: string, player: string) =>
    ['member-stats-materialized', guild, player] as const,
  tokenOffenders: (guild: string) =>
    ['member-stats-materialized', guild, 'offenders'] as const
}

export function useMemberStatsMaterialized(
  guild: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: memberStatsKeys.guild(guild),
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const supabase = dbClient()
      const { data, error } = await supabase.rpc('get_guild_member_stats', {
        p_guild_code: guild
      })

      if (error) throw error
      return (data ?? []) as unknown as MemberStatsSummary[]
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

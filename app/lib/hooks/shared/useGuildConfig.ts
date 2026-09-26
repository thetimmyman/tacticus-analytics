import { dbClient } from '@/app/lib/db/client'
import type { GuildConfig } from '@tacticus/app-core/types'
import { useBaseQuery } from './useBaseQuery'
import { PUBLIC_GUILD_CONFIG_SELECT } from '@/app/lib/guild-config-selects'

export function useGuildConfig(
  guildCode: string,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? Boolean(guildCode)

  return useBaseQuery<GuildConfig>({
    queryKey: ['guild-config', guildCode],
    queryFn: async () => {
      const supabase = dbClient()
      const { data, error } = await supabase
        .from('guild_config')
        .select(PUBLIC_GUILD_CONFIG_SELECT)
        .eq('guild_code', guildCode)
        .single()

      if (error) throw error
      return data as unknown as GuildConfig
    },
    enabled,
    cacheDuration: 10 * 60 * 1000
  })
}

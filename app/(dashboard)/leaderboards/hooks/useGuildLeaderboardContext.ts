'use client'

import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import { dbClient } from '@/app/lib/db/client'
import { getLatestSeasonClient } from '@/app/lib/data/get-latest-season-client'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

export const GUILD_LEADERBOARD_CONTEXT_SELECT =
  'guild_code, display_name, guild_tag, cluster_code'

interface GuildLeaderboardContextRow {
  guild_code: string | null
  display_name: string | null
  guild_tag: string | null
  cluster_code: string | null
}

export interface GuildLeaderboardContext {
  season: string
  guildDisplayName: string
  hasCluster: boolean
}

export async function fetchGuildLeaderboardContext(
  guildCode: string,
  supabase: SupabaseClient<Database> = dbClient()
): Promise<GuildLeaderboardContext> {
  const [season, guildResult] = await Promise.all([
    getLatestSeasonClient(),
    supabase
      .from('guild_config')
      .select(GUILD_LEADERBOARD_CONTEXT_SELECT)
      .eq('guild_code', guildCode)
      .single()
  ])

  if (!season) {
    throw new Error('Season data unavailable')
  }

  const guildError = guildResult.error as {
    code?: string
    message?: string
  } | null
  if (guildError && guildError.code !== 'PGRST116') {
    throw new Error(
      `Failed to load guild leaderboard context: ${
        guildError.message ?? 'guild_config lookup failed'
      }`
    )
  }

  const guildData =
    (guildResult.data as GuildLeaderboardContextRow | null) ?? null

  return {
    season,
    guildDisplayName: formatGuildDisplayLabel(guildData, guildCode),
    hasCluster: Boolean(guildData?.cluster_code)
  }
}

export function useGuildLeaderboardContext(guildCode: string) {
  return useQuery({
    queryKey: ['guild-leaderboard-context', guildCode],
    queryFn: () => fetchGuildLeaderboardContext(guildCode),
    enabled: !!guildCode,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

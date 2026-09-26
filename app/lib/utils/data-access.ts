// Cluster-then-guild access context for cluster and shared pages, not guild-only or player pages.

import { dbClient } from '@/app/lib/db/client'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { GUILD_DISPLAY_SELECT } from '@/app/lib/guild-config-selects'

export interface UserDataContext {
  clusterCode: string | null
  guildCode: string | null
  guildDisplayName?: string | null
  guildTag?: string | null
  guildLabel?: string | null
  hasClusterAccess: boolean
  hasGuildAccess: boolean
  accessLevel: 'cluster' | 'guild' | 'none'
}

export async function getUserDataContextClient(): Promise<UserDataContext> {
  const supabase = dbClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      clusterCode: null,
      guildCode: null,
      hasClusterAccess: false,
      hasGuildAccess: false,
      accessLevel: 'none'
    }
  }

  const { data: profile } = await supabase
    .from('player_with_cluster')
    .select('cluster_code, guild_code')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return {
      clusterCode: null,
      guildCode: null,
      guildDisplayName: null,
      guildTag: null,
      guildLabel: null,
      hasClusterAccess: false,
      hasGuildAccess: false,
      accessLevel: 'none'
    }
  }

  const { data: guildConfig } = profile.guild_code
    ? await supabase
        .from('guild_config')
        .select(GUILD_DISPLAY_SELECT)
        .eq('guild_code', profile.guild_code)
        .maybeSingle()
    : { data: null }

  return {
    clusterCode: profile.cluster_code,
    guildCode: profile.guild_code,
    guildDisplayName: guildConfig?.display_name ?? null,
    guildTag: guildConfig?.guild_tag ?? null,
    guildLabel: formatGuildDisplayLabel(guildConfig, profile.guild_code),
    hasClusterAccess: !!profile.cluster_code,
    hasGuildAccess: !!profile.guild_code,
    accessLevel: profile.cluster_code
      ? 'cluster'
      : profile.guild_code
        ? 'guild'
        : 'none'
  }
}

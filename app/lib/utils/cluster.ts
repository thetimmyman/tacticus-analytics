import { db } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.utils.cluster')

export async function getClusterInfo(
  guildCode: string
): Promise<{ display_name: string; short_name: string; description: string }> {
  try {
    const supabase = await db()

    const guildConfig = await GuildConfigService.getBasic(supabase, guildCode)

    if (!guildConfig?.cluster_id) {
      return {
        display_name: 'Tacticus Analytics',
        short_name: 'TA',
        description: 'Guild analytics cluster'
      }
    }

    const { data: cluster } = await supabase
      .from('clusters')
      .select('display_name, short_name, description')
      .eq('id', guildConfig.cluster_id)
      .single()

    if (!cluster) {
      return {
        display_name: 'Tacticus Analytics',
        short_name: 'TA',
        description: 'Guild analytics cluster'
      }
    }

    return {
      display_name: cluster.display_name ?? 'Tacticus Analytics',
      short_name: cluster.short_name ?? 'TA',
      description: cluster.description ?? 'Guild analytics cluster'
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting cluster info:')
    return {
      display_name: 'Tacticus Analytics',
      short_name: 'TA',
      description: 'Guild analytics cluster'
    }
  }
}

export async function getClusterInfoFromProfile(
  profile: { guild_code?: string } | null | undefined
): Promise<{ display_name: string; short_name: string; description: string }> {
  if (!profile?.guild_code) {
    return {
      display_name: 'Tacticus Analytics',
      short_name: 'TA',
      description: 'Guild analytics cluster'
    }
  }

  return getClusterInfo(profile.guild_code)
}

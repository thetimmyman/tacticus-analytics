import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.webhooks.webhook-helper')
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

export interface WebhookConfig {
  id?: string
  webhook_type: string
  webhook_url: string | null
  enabled: boolean
  guild_code?: string | null
  cluster_id?: string | null
}

/** Per type in order: guild webhook, then cluster webhook. Enabled URLs only. */
export async function findWebhookForGuild(
  guildCode: string,
  webhookType: string,
  fallbackTypes?: string[]
): Promise<string | null> {
  const supabase = await db()

  const typesToTry = [webhookType, ...(fallbackTypes || [])]

  for (const type of typesToTry) {
    const { data: guildWebhook } = await supabase
      .from('webhook_config')
      .select('webhook_url, enabled')
      .eq('webhook_type', type)
      .eq('guild_code', guildCode)
      .single()

    if (guildWebhook?.enabled && guildWebhook?.webhook_url) {
      logger.info({ type, guildCode }, 'Found guild webhook')
      return guildWebhook.webhook_url
    }

    const guildConfig = await GuildConfigService.getBasic(supabase, guildCode)

    if (guildConfig?.cluster_code) {
      const { data: cluster } = await supabase
        .from('clusters')
        .select('id')
        .eq('cluster_code', guildConfig.cluster_code)
        .single()

      if (cluster) {
        const { data: clusterWebhook } = await supabase
          .from('webhook_config')
          .select('webhook_url, enabled')
          .eq('webhook_type', type)
          .eq('cluster_id', cluster.id)
          .single()

        if (clusterWebhook?.enabled && clusterWebhook?.webhook_url) {
          logger.info(
            {
              type,
              clusterCode: guildConfig.cluster_code,
              guildCode
            },
            'Found cluster webhook'
          )
          return clusterWebhook.webhook_url
        }
      }
    }
  }

  logger.info(
    {
      types: typesToTry,
      guildCode,
      message: 'No enabled webhooks found'
    },
    'No webhook found'
  )

  return null
}

export async function getClusterWebhooks(clusterId: string) {
  const supabase = await db()

  const { data: clusterData } = await supabase
    .from('clusters')
    .select('cluster_code')
    .eq('id', clusterId)
    .single()

  if (!clusterData) return []

  const { data: guilds } = await supabase
    .from('guild_config')
    .select('guild_code, display_name')
    .eq('cluster_code', clusterData.cluster_code)

  const { data: webhooks } = await supabase
    .from('webhook_config')
    .select('*')
    .or(
      `cluster_id.eq.${clusterId},guild_code.in.(${guilds?.map((g) => g.guild_code).join(',') || ''})`
    )

  const webhooksArray = webhooks || []
  return {
    // A row with both guild_code and cluster_id is a guild webhook; treating it
    // as cluster-scoped leaks cluster content into a guild channel.
    clusterWebhooks: webhooksArray.filter(
      (w) => w.cluster_id === clusterId && !w.guild_code
    ),
    guildWebhooks: webhooksArray.filter((w) => w.guild_code),
    guilds: guilds || []
  }
}

export async function saveWebhook(
  webhookType: string,
  webhookUrl: string | null,
  enabled: boolean,
  scope: { guildCode?: string; clusterId?: string }
) {
  const supabase = await db()

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  let query = supabase
    .from('webhook_config')
    .select('id')
    .eq('webhook_type', webhookType)

  if (scope.guildCode) {
    query = query.eq('guild_code', scope.guildCode)
  } else if (scope.clusterId) {
    query = query.eq('cluster_id', scope.clusterId)
  } else {
    throw new Error('Either guildCode or clusterId must be provided')
  }

  const { data: existing } = await query.single()

  if (existing) {
    const { data, error } = await supabase
      .from('webhook_config')
      .update({
        webhook_url: webhookUrl,
        enabled,
        updated_at: new Date().toISOString(),
        updated_by: user.id
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw error
    return data
  } else {
    const { data, error } = await supabase
      .from('webhook_config')
      .insert({
        webhook_type: webhookType,
        webhook_url: webhookUrl,
        enabled,
        guild_code: scope.guildCode || undefined,
        cluster_id: scope.clusterId || undefined,
        updated_by: user.id
      })
      .select()
      .single()

    if (error) throw error
    return data
  }
}

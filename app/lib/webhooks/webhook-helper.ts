import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.webhooks.webhook-helper')
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { loadWebhookUrlById } from './webhook-url-lookup'

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
      .select('id, enabled')
      .eq('webhook_type', type)
      .eq('guild_code', guildCode)
      .single()

    if (guildWebhook?.enabled) {
      const webhookUrl = await loadWebhookUrlById(guildWebhook.id)
      if (webhookUrl) {
        logger.info({ type, guildCode }, 'Found guild webhook')
        return webhookUrl
      }
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
          .select('id, enabled')
          .eq('webhook_type', type)
          .eq('cluster_id', cluster.id)
          .single()

        if (clusterWebhook?.enabled) {
          const webhookUrl = await loadWebhookUrlById(clusterWebhook.id)
          if (webhookUrl) {
            logger.info(
              {
                type,
                clusterCode: guildConfig.cluster_code,
                guildCode
              },
              'Found cluster webhook'
            )
            return webhookUrl
          }
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

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { logger } from '../_shared/logger.ts'
import { sendWebhookMessage } from '../_shared/discord-webhook.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }
  try {
    const supabase = createServiceClient()

    // Prune notifications older than 60 minutes so no backlog builds up.
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await supabase
      .from('token_cap_notifications')
      .delete()
      .lt('created_at', sixtyMinutesAgo)

    const { data: pendingNotifications, error: fetchError } = await supabase
      .from('token_cap_notifications')
      .select('*')
      .eq('notification_sent', false)
      .order('capped_at', { ascending: true })
    if (fetchError) {
      logger.error('Error fetching notifications:', fetchError)
      throw fetchError
    }
    if (!pendingNotifications || pendingNotifications.length === 0) {
      return jsonResponse({
        success: true,
        message: 'No pending notifications'
      })
    }
    const notificationsByGuild = new Map()
    for (const notification of pendingNotifications) {
      if (!notificationsByGuild.has(notification.guild_code)) {
        notificationsByGuild.set(notification.guild_code, [])
      }
      notificationsByGuild.get(notification.guild_code).push(notification)
    }
    const results = []
    for (const [guildCode, guildNotifications] of notificationsByGuild) {
      const { data: guildInfo } = await supabase
        .from('guild_config')
        .select('display_name, guild_tag, cluster_code')
        .eq('guild_code', guildCode)
        .single()
      const { data: webhookConfig } = await supabase
        .from('webhook_config')
        .select('webhook_url')
        .eq('guild_code', guildCode)
        .eq('webhook_type', 'token_cap_notification')
        .eq('enabled', true)
        .single()
      if (!webhookConfig?.webhook_url) {
        results.push({
          guild_code: guildCode,
          status: 'skipped',
          reason: 'No webhook configured'
        })
        continue
      }
      const newlyCappedPlayers = guildNotifications
        .map((n: { display_name: string }) => n.display_name)
        .filter((n: string) => n)
      const cappedCount =
        guildNotifications[0]?.total_capped_in_guild ||
        newlyCappedPlayers.length
      const urgencyColor =
        cappedCount >= 10
          ? 0xff0000 // Red for 10+ capped
          : cappedCount >= 5
            ? 0xffa500 // Orange for 5-9 capped
            : 0xffff00 // Yellow for 1-4 capped
      const embed = {
        title: `⚠️ Token Cap Alert - ${guildInfo?.display_name || guildInfo?.guild_tag || 'Guild'}`,
        description:
          cappedCount >= 5
            ? '**Multiple players are capped at 3/3 tokens!**\nConsider coordinating attacks to maximize damage.'
            : 'Player(s) have reached maximum tokens (3/3).',
        color: urgencyColor,
        fields: [
          {
            name: '🔔 Newly Capped Players',
            value:
              newlyCappedPlayers.length > 0
                ? newlyCappedPlayers.map((p: string) => `• ${p}`).join('\n')
                : 'Unknown players',
            inline: false
          },
          {
            name: '📊 Guild Status',
            value: `**Total Capped:** ${cappedCount} players`,
            inline: false
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: `${guildInfo?.display_name || guildInfo?.guild_tag || 'Guild'} Token Monitor`
        }
      }
      if (cappedCount >= 10) {
        embed.fields.push({
          name: '🚨 URGENT ACTION NEEDED',
          value:
            'Many players are capped! Coordinate attacks immediately to avoid wasting tokens.',
          inline: false
        })
      }
      // ignoreEnabledFlag: this site never checked the flag, and it keeps the throw-on-failure contract meaningful.
      try {
        const result = await sendWebhookMessage(
          webhookConfig.webhook_url,
          { embeds: [embed], username: 'Token Cap Alert' },
          { ignoreEnabledFlag: true }
        )
        if (!result.success) {
          const errorText = result.error ?? 'unknown error'
          logger.error(`Discord API error: ${errorText}`)
          throw new Error(`Discord API error: ${errorText}`)
        }
        const notificationIds = guildNotifications.map(
          (n: { id: number }) => n.id
        )
        await supabase
          .from('token_cap_notifications')
          .update({
            notification_sent: true,
            sent_at: new Date().toISOString()
          })
          .in('id', notificationIds)
        await supabase
          .from('webhook_config')
          .update({ last_tested: new Date().toISOString() })
          .eq('guild_code', guildCode)
          .eq('webhook_type', 'token_cap_notification')
        results.push({
          guild_code: guildCode,
          status: 'sent',
          capped_count: cappedCount,
          newly_capped: newlyCappedPlayers.length
        })
      } catch (webhookError) {
        logger.error(`Failed to send webhook for ${guildCode}:`, webhookError)
        results.push({
          guild_code: guildCode,
          status: 'failed',
          error:
            webhookError instanceof Error
              ? webhookError.message
              : String(webhookError)
        })
      }
    }
    const successCount = results.filter((r) => r.status === 'sent').length
    console.log(`✅ Cap Notifications Complete:
    Guilds Processed: ${results.length}
    Notifications Sent: ${successCount}
    Failed: ${results.filter((r) => r.status === 'failed').length}
    Skipped: ${results.filter((r) => r.status === 'skipped').length}`)
    return jsonResponse({
      success: true,
      results,
      summary: {
        total_guilds: results.length,
        notifications_sent: successCount,
        total_players_capped: pendingNotifications.length
      }
    })
  } catch (error) {
    logger.error('Error processing cap notifications:', error)
    logger.error(
      `❌ Cap Notifications Error: ${error instanceof Error ? error.message : String(error)}`
    )
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})

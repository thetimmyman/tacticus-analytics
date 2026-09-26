import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { logger } from '../_shared/logger.ts'
import { sendWebhookMessage } from '../_shared/discord-webhook.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { requireAuth } from '../_shared/auth-guard.ts'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'
import {
  loadDuplicateNameLabels,
  relabelForDisplay
} from '../_shared/duplicate-name-labels.ts'
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }

  const authError = requireAuth(req)
  if (authError) return authError

  try {
    const supabase = createServiceClient()
    const labelMap = await loadDuplicateNameLabels(supabase)
    const startTime = Date.now()
    const url = new URL(req.url)
    const specificGuild = url.searchParams.get('guild')
    const specificCluster = url.searchParams.get('cluster')
    let tokenQuery = supabase
      .from('player_mapping')
      .select(
        `
        player_id,
        display_name,
        guild_code,
        last_sync_tokens,
        last_sync_at,
        created_at
      `
      )
      .eq('is_current', true)
      .not('last_sync_tokens', 'is', null)
      .order('last_sync_tokens', { ascending: false })
    if (specificGuild) {
      tokenQuery = tokenQuery.eq('guild_code', specificGuild)
    }
    const { data: tokenData, error: tokenError } = await tokenQuery
    if (tokenError) {
      logger.error('Error fetching token data:', tokenError)
      throw tokenError
    }
    const { data: guildConfigs, error: configError } = await supabase
      .from('guild_config')
      .select('guild_code, display_name, cluster_code')
    if (configError) {
      logger.error('Error fetching guild configs:', configError)
      throw configError
    }
    const guildConfigMap = new Map()
    for (const config of guildConfigs || []) {
      guildConfigMap.set(config.guild_code, config)
    }
    let filteredTokenData = tokenData || []
    if (specificCluster) {
      filteredTokenData = filteredTokenData.filter(
        (player: Record<string, unknown>) => {
          const config = guildConfigMap.get(player.guild_code)
          return config && config.cluster_code === specificCluster
        }
      )
    }
    const guildStats = new Map()
    const clusterStats = new Map()
    for (const player of filteredTokenData) {
      const guildCode = player.guild_code
      const guildConfig = guildConfigMap.get(guildCode)
      const clusterCode = guildConfig?.cluster_code
      // Display only: players[].name is never a key.
      const displayName = relabelForDisplay(player.display_name, labelMap)
      const tokensRemaining = player.last_sync_tokens || 0
      if (!guildCode) continue
      if (!guildStats.has(guildCode)) {
        guildStats.set(guildCode, {
          code: guildCode,
          name: guildConfig?.display_name || guildCode,
          cluster: clusterCode,
          players: [],
          totalTokens: 0,
          availablePlayers: 0
        })
      }
      const guild = guildStats.get(guildCode)
      guild.players.push({
        name: displayName,
        tokens: tokensRemaining
      })
      guild.totalTokens += tokensRemaining
      if (tokensRemaining > 0) guild.availablePlayers++
      if (clusterCode) {
        if (!clusterStats.has(clusterCode)) {
          clusterStats.set(clusterCode, {
            code: clusterCode,
            totalTokens: 0,
            availablePlayers: 0,
            guilds: new Set()
          })
        }
        const cluster = clusterStats.get(clusterCode)
        cluster.totalTokens += tokensRemaining
        if (tokensRemaining > 0) cluster.availablePlayers++
        cluster.guilds.add(guildCode)
      }
    }
    const webhooksSent = []
    for (const [guildCode, stats] of guildStats) {
      const webhookResult = await sendGuildAvailability(
        supabase,
        guildCode,
        stats
      )
      if (webhookResult.sent) {
        webhooksSent.push(guildCode)
      }
    }
    for (const [clusterCode, stats] of clusterStats) {
      await sendClusterAvailability(supabase, clusterCode, stats, guildStats)
    }
    const duration = Date.now() - startTime
    return jsonResponse({
      success: true,
      guilds: guildStats.size,
      clusters: clusterStats.size,
      webhooks_sent: webhooksSent,
      duration_ms: duration
    })
  } catch (error) {
    logger.error('Error in gr-availability:', error)
    logger.error(
      `❌ GR Availability Error: ${error instanceof Error ? error.message : String(error)}`
    )
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})
async function sendGuildAvailability(
  supabase: any,
  guildCode: string,
  stats: any
) {
  try {
    const { data: webhookConfig } = await supabase
      .from('webhook_config')
      .select('webhook_url')
      .eq('guild_code', guildCode)
      .eq('webhook_type', 'gr_availability')
      .eq('enabled', true)
      .single()
    if (!webhookConfig?.webhook_url) {
      return { sent: false }
    }
    stats.players.sort((a: any, b: any) => b.tokens - a.tokens)
    const fields = []
    fields.push({
      name: '📊 Summary',
      value: `**Available Players:** ${stats.availablePlayers}\n**Total Tokens:** ${stats.totalTokens}`,
      inline: false
    })
    const topPlayers = stats.players
      .filter((p: any) => p.tokens > 0)
      .slice(0, 10)
      .map((p: any, i: number) => {
        const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▫️'
        return `${emoji} **${p.name}** - ${p.tokens} token${p.tokens !== 1 ? 's' : ''}`
      })
    if (topPlayers.length > 0) {
      fields.push({
        name: '🎮 Available Players',
        value: topPlayers.join('\n'),
        inline: false
      })
    }
    const noTokenPlayers = stats.players.filter(
      (p: any) => p.tokens === 0
    ).length
    if (noTokenPlayers > 0) {
      fields.push({
        name: '⏸️ Out of Tokens',
        value: `${noTokenPlayers} player${noTokenPlayers !== 1 ? 's' : ''} currently have no tokens`,
        inline: false
      })
    }
    const embed = {
      title: `🎮 GR Token Availability - ${stats.name}`,
      description: 'Current token status for guild members',
      color:
        stats.availablePlayers > 5
          ? 0x00ff00
          : stats.availablePlayers > 0
            ? 0xffff00
            : 0xff0000,
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: `${stats.name} Guild Raid Dashboard`
      }
    }
    // ignoreEnabledFlag: this site never checked the feature flag.
    const result = await sendWebhookMessage(
      webhookConfig.webhook_url,
      { embeds: [embed], username: 'GR Availability Bot' },
      { ignoreEnabledFlag: true }
    )
    if (!result.success) {
      logger.error(
        `Failed to send availability for ${guildCode}:`,
        result.error
      )
      return { sent: false }
    }
    await supabase
      .from('webhook_config')
      .update({ last_tested: new Date().toISOString() })
      .eq('guild_code', guildCode)
      .eq('webhook_type', 'gr_availability')
    return { sent: true }
  } catch (error) {
    logger.error(`Error sending availability for ${guildCode}:`, error)
    return { sent: false }
  }
}
async function sendClusterAvailability(
  supabase: any,
  clusterCode: string,
  stats: any,
  guildStats: Map<string, any>
) {
  try {
    const { data: clusterInfo } = await supabase
      .from('clusters')
      .select('id, display_name')
      .eq('cluster_code', clusterCode)
      .single()
    if (!clusterInfo) return
    const { data: webhookConfig } = await supabase
      .from('webhook_config')
      .select('webhook_url')
      .eq('cluster_id', clusterInfo.id)
      // A cluster webhook must not be guild-scoped, or a dual-tagged row leaks cluster content into a guild.
      .is('guild_code', null)
      .eq('webhook_type', 'gr_availability')
      .eq('enabled', true)
      .single()
    if (!webhookConfig?.webhook_url) {
      return
    }
    const guildSummaries = []
    for (const guildCode of stats.guilds) {
      const guild = guildStats.get(guildCode)
      if (guild) {
        guildSummaries.push({
          name: guild.name,
          available: guild.availablePlayers,
          tokens: guild.totalTokens
        })
      }
    }
    guildSummaries.sort((a, b) => b.available - a.available)
    const fields = []
    fields.push({
      name: '🌍 Cluster Summary',
      value: `**Total Available Players:** ${stats.availablePlayers}\n**Total Tokens:** ${stats.totalTokens}\n**Active Guilds:** ${stats.guilds.size}`,
      inline: false
    })
    const guildList = guildSummaries
      .map((g) => `**${g.name}:** ${g.available} players, ${g.tokens} tokens`)
      .join('\n')
    fields.push({
      name: '🏰 Guild Breakdown',
      value: guildList || 'No guild data available',
      inline: false
    })
    const embed = {
      title: `🌍 ${clusterInfo.display_name || clusterCode} - Cluster GR Availability`,
      description: 'Token availability across all guilds',
      color: 0x4b0082, // Indigo for cluster
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: `${clusterInfo.display_name || clusterCode} Cluster Dashboard`
      }
    }
    // ignoreEnabledFlag: this site never checked the feature flag.
    const result = await sendWebhookMessage(
      webhookConfig.webhook_url,
      { embeds: [embed], username: 'Cluster Availability Bot' },
      { ignoreEnabledFlag: true }
    )
    if (!result.success) {
      logger.error(
        `Failed to send cluster availability for ${clusterCode}:`,
        result.error
      )
    }
  } catch (error) {
    logger.error(
      `Error sending cluster availability for ${clusterCode}:`,
      error
    )
  }
}

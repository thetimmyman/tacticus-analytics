import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { logger } from '../_shared/logger.ts'
import { sendWebhookMessage } from '../_shared/discord-webhook.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'
import {
  loadDuplicateNameLabels,
  relabelForDisplay
} from '../_shared/duplicate-name-labels.ts'
// Port of the frontend token calculation.
const TWELVE_HOURS_IN_SECONDS = 12 * 60 * 60
const MAX_TOKENS = 3
const INITIAL_TOKENS = 2
interface TokenStatus {
  count: number
  refreshTime: number
}
interface Battle {
  displayName: string
  damageType: string
  startedOn: string | null
  completedOn?: string | null
}
function evaluateToken(
  token: TokenStatus,
  timestampInSeconds: number
): TokenStatus {
  if (token.count >= MAX_TOKENS) {
    return token
  }
  const nRecharged = Math.floor(
    (timestampInSeconds - token.refreshTime) / TWELVE_HOURS_IN_SECONDS
  )
  if (nRecharged + token.count >= MAX_TOKENS) {
    token.count = MAX_TOKENS
    token.refreshTime = timestampInSeconds
  } else {
    token.count += nRecharged
    token.refreshTime += nRecharged * TWELVE_HOURS_IN_SECONDS
  }
  return token
}
function calculateTokenAvailability(
  battles: Battle[],
  currentTime: Date = new Date()
): number {
  const now = Math.floor(currentTime.getTime() / 1000)
  const tokenBattles = battles.filter(
    (b) => b.damageType === 'Battle' && b.startedOn
  )
  if (tokenBattles.length === 0) {
    return MAX_TOKENS
  }
  const sortedTokenBattles = [...tokenBattles].sort((a, b) => {
    const aTime = new Date(a.startedOn!).getTime()
    const bTime = new Date(b.startedOn!).getTime()
    return aTime - bTime
  })
  const firstBattleTimestamp = Math.floor(
    new Date(sortedTokenBattles[0].startedOn!).getTime() / 1000
  )
  let tokenStatus: TokenStatus = {
    count: INITIAL_TOKENS,
    refreshTime: firstBattleTimestamp
  }
  sortedTokenBattles.forEach((battle) => {
    const battleTimestamp = Math.floor(
      new Date(battle.startedOn!).getTime() / 1000
    )
    tokenStatus = evaluateToken(tokenStatus, battleTimestamp)
    const previousCount = tokenStatus.count
    tokenStatus.count--
    if (tokenStatus.count <= 0) {
      tokenStatus.count = 0
      if (previousCount > 0) {
        tokenStatus.refreshTime = battleTimestamp
      }
    }
  })
  tokenStatus = evaluateToken(tokenStatus, now)
  return Math.min(Math.max(0, tokenStatus.count), MAX_TOKENS)
}
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }
  try {
    const supabase = createServiceClient()
    // Labels for display strings only; persisted display_name stays raw.
    const labelMap = await loadDuplicateNameLabels(supabase)
    const { guild_code, check_all = false } = await req
      .json()
      .catch(() => ({ check_all: true }))
    let guildsToCheck: string[] = []
    if (guild_code) {
      guildsToCheck = [guild_code]
    } else if (check_all) {
      const { data: webhooks } = await supabase
        .from('webhook_config')
        .select('guild_code')
        .eq('webhook_type', 'token_cap_notification')
        .eq('enabled', true)
        .not('guild_code', 'is', null)
      guildsToCheck =
        webhooks
          ?.map((w: { guild_code: string }) => w.guild_code)
          .filter(Boolean) || []
      console.log(
        `Found ${guildsToCheck.length} guilds with cap webhooks enabled: ${guildsToCheck.join(', ')}`
      )
    }
    if (guildsToCheck.length === 0) {
      return jsonResponse({
        message: 'No guilds to check'
      })
    }
    const results = []
    const allNewlyCapped = []
    for (const guildCode of guildsToCheck) {
      // "Season" is TEXT and lex-sorts; use the numeric RPC.
      const { data: seasonRpcData } = await supabase.rpc(
        'get_latest_season_for_guild',
        { p_guild: guildCode }
      )
      const currentSeason = seasonRpcData ? String(seasonRpcData) : null
      if (!currentSeason) continue
      const { data: players } = await supabase
        .from('player_mapping')
        .select('player_id, display_name')
        .eq('guild_code', guildCode)
        .eq('is_current', true)
      if (!players || players.length === 0) continue
      const cappedPlayers = []
      for (const player of players) {
        const { data: battles } = await supabase
          .from('EOT_GR_data')
          .select('displayName, damageType, startedOn, completedOn')
          .eq('displayName', player.display_name)
          .eq('Guild', guildCode)
          .eq('Season', currentSeason)
          .order('startedOn', { ascending: true })
        const tokensAvailable = calculateTokenAvailability(battles || [])
        if (tokensAvailable === 3) {
          cappedPlayers.push({
            player_id: player.player_id,
            display_name: player.display_name,
            tokens: tokensAvailable
          })
        }
      }
      // Newly capped: not notified in the last 12 hours.
      const newlyCapped = []
      for (const capped of cappedPlayers) {
        const { data: recentNotification } = await supabase
          .from('token_cap_notifications')
          .select('id')
          .eq('player_id', capped.player_id)
          .eq('guild_code', guildCode)
          .gte(
            'capped_at',
            new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
          )
          .single()
        if (!recentNotification) {
          newlyCapped.push(capped)
        }
      }
      if (newlyCapped.length > 0) {
        for (const player of newlyCapped) {
          await supabase.from('token_cap_notifications').insert({
            player_id: player.player_id,
            display_name: player.display_name,
            guild_code: guildCode,
            capped_at: new Date().toISOString(),
            total_capped_in_guild: cappedPlayers.length,
            notification_sent: false
          })
        }
        const { data: webhookConfig } = await supabase
          .from('webhook_config')
          .select('webhook_url')
          .eq('guild_code', guildCode)
          .eq('webhook_type', 'token_cap_notification')
          .eq('enabled', true)
          .single()
        if (webhookConfig?.webhook_url) {
          const { data: guildInfo } = await supabase
            .from('guild_config')
            .select('display_name')
            .eq('guild_code', guildCode)
            .single()
          const urgencyColor =
            cappedPlayers.length >= 10
              ? 0xff0000
              : cappedPlayers.length >= 5
                ? 0xffa500
                : 0xffff00
          const embed = {
            title: `⚠️ Players Capped - ${guildInfo?.display_name || guildCode}`,
            description: `${newlyCapped.length} player(s) have reached 3/3 tokens!`,
            color: urgencyColor,
            fields: [
              {
                name: '🆕 Newly Capped',
                value: newlyCapped
                  .slice(0, 10)
                  .map(
                    (p) =>
                      `• **${relabelForDisplay(p.display_name, labelMap)}**`
                  )
                  .join('\n'),
                inline: false
              },
              {
                name: '📊 Guild Status',
                value: `**Total Capped:** ${cappedPlayers.length} players\n**Action Required:** Coordinate attacks`,
                inline: false
              }
            ],
            timestamp: new Date().toISOString(),
            footer: {
              text: 'Automatic Detection'
            }
          }
          // ignoreEnabledFlag: this site never checked the feature flag.
          const result = await sendWebhookMessage(
            webhookConfig.webhook_url,
            { embeds: [embed], username: 'Token Cap Alert' },
            { ignoreEnabledFlag: true }
          )
          if (result.success) {
            await supabase
              .from('token_cap_notifications')
              .update({
                notification_sent: true,
                sent_at: new Date().toISOString()
              })
              .in(
                'player_id',
                newlyCapped.map((p) => p.player_id)
              )
              .eq('guild_code', guildCode)
              .eq('notification_sent', false)
          }
        }
        allNewlyCapped.push(
          ...newlyCapped.map((p) => ({ ...p, guild: guildCode }))
        )
      }
      results.push({
        guild: guildCode,
        total_capped: cappedPlayers.length,
        newly_capped: newlyCapped.length
      })
    }
    return jsonResponse({
      success: true,
      guilds_checked: guildsToCheck.length,
      total_newly_capped: allNewlyCapped.length,
      results
    })
  } catch (error) {
    logger.error('Error in check-capped-players:', error)
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})

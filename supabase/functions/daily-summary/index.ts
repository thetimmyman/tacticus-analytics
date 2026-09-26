import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  loadPlayerNameMap,
  resolveDisplayName,
  type PlayerNameMap
} from '../_shared/player-name-resolution.ts'
import {
  loadDuplicateNameLabels,
  relabelForDisplay,
  type FriendlyLabelMap
} from '../_shared/duplicate-name-labels.ts'
import { logger } from '../_shared/logger.ts'
import { sendWebhookMessage } from '../_shared/discord-webhook.ts'
import {
  createServiceClient,
  type SupabaseClient
} from '../_shared/supabase-client.ts'
import { isMeaningfulBattleRow } from '../_shared/damage-classification.ts'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'

type SupabaseDailyClient = SupabaseClient

type ClusterRow = {
  id: number
  cluster_code: string
  display_name: string | null
}

type BattleRow = {
  displayName: string | null
  userId: string | null
  Guild: string | null
  Name: string | null
  type: string | null
  encounterIndex: number | null
  damageDealt: number | null
  damageType: string | null
  remainingHp: number | null
  maxHp: number | null
}

type TopBattleEntry = {
  player: string
  guild: string
  boss: string
  damage: number
}

type DailySummaryStats = {
  total_damage: number
  total_battles: number
  active_players: number
  unique_bosses: number
  avg_damage: number
  top_performer: string
  top_damage: number
  top_battles: TopBattleEntry[]
  guilds_active: number
}

type SummaryResult =
  | { cluster: string; status: 'sent'; stats: DailySummaryStats }
  | { cluster: string; status: 'failed'; error: string }

type WebhookResult = { success: true } | { success: false; error: string }

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? 'Unknown error')

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }

  try {
    const supabase = createServiceClient() as SupabaseDailyClient
    const startTime = Date.now()

    const { data: clustersData } = await supabase
      .from('clusters')
      .select('id, cluster_code, display_name')
      .eq('is_active', true)
      .returns<ClusterRow[]>()

    const clusters = clustersData ?? []
    if (clusters.length === 0) {
      return jsonResponse({ message: 'No active clusters found' })
    }

    const playerNameMap = await loadPlayerNameMap(supabase)
    // Duplicate-name labels are for DISPLAY strings only.
    const labelMap = await loadDuplicateNameLabels(supabase)

    const results: SummaryResult[] = []

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStart = new Date(
      yesterday.getFullYear(),
      yesterday.getMonth(),
      yesterday.getDate(),
      0,
      0,
      0,
      0
    )
    const yesterdayEnd = new Date(
      yesterday.getFullYear(),
      yesterday.getMonth(),
      yesterday.getDate(),
      23,
      59,
      59,
      999
    )

    for (const cluster of clusters) {
      const stats = await generateDailySummary(
        supabase,
        cluster.cluster_code,
        yesterdayStart,
        yesterdayEnd,
        playerNameMap,
        labelMap
      )
      const summaryResult = await sendDailySummaryWebhook(
        supabase,
        cluster,
        stats,
        yesterday
      )

      if (summaryResult.success) {
        results.push({
          cluster: cluster.cluster_code,
          status: 'sent',
          stats
        })
      } else {
        results.push({
          cluster: cluster.cluster_code,
          status: 'failed',
          error: summaryResult.error
        })
      }
    }

    const duration = Date.now() - startTime

    return jsonResponse({
      success: true,
      results,
      duration_ms: duration
    })
  } catch (error) {
    const message = toErrorMessage(error)
    logger.error('Error in daily-summary:', error)
    logger.error(`❌ Daily Summary Error: ${message}`)
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})

async function generateDailySummary(
  supabase: SupabaseDailyClient,
  clusterCode: string,
  startDate: Date,
  endDate: Date,
  playerNameMap: Map<string, string>,
  labelMap: FriendlyLabelMap
): Promise<DailySummaryStats> {
  const { data: battleData } = await supabase
    .from('EOT_GR_data')
    .select(
      'displayName, userId, Guild, Name, type, encounterIndex, damageDealt, damageType, remainingHp, maxHp'
    )
    .eq('cluster_code', clusterCode)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString())
    .returns<BattleRow[]>()

  if (!battleData || battleData.length === 0) {
    return {
      total_damage: 0,
      total_battles: 0,
      active_players: 0,
      unique_bosses: 0,
      avg_damage: 0,
      top_performer: 'N/A',
      top_damage: 0,
      top_battles: [],
      guilds_active: 0
    }
  }

  const totalDamage = battleData.reduce(
    (sum: number, battle: BattleRow) => sum + (battle.damageDealt ?? 0),
    0
  )
  const totalBattles = battleData.length

  // avg_damage matches the web (Battle rows only, no crashes or sweeps); totals and top battles stay raw.
  const meaningfulBattles = battleData.filter(isMeaningfulBattleRow)
  const meaningfulDamage = meaningfulBattles.reduce(
    (sum: number, battle: BattleRow) => sum + (battle.damageDealt ?? 0),
    0
  )

  const uniquePlayers = new Set(
    battleData
      .map((battle: BattleRow) =>
        resolveDisplayName(battle.displayName, battle.userId, playerNameMap)
      )
      .filter((name: string | null): name is string =>
        Boolean(name && name.length > 0)
      )
  )

  const uniqueBosses = new Set(
    battleData.map((battle: BattleRow) => {
      const bossType = battle.type ?? 'unknown'
      const encounter = battle.encounterIndex ?? -1
      return `${bossType}_${encounter}`
    })
  )

  const uniqueGuilds = new Set(
    battleData
      .map((battle: BattleRow) => battle.Guild?.trim())
      .filter((guild: string | undefined): guild is string =>
        Boolean(guild && guild.length > 0)
      )
  )

  const playerDamage = new Map<string, number>()
  for (const battle of battleData) {
    const playerName = resolveDisplayName(
      battle.displayName,
      battle.userId,
      playerNameMap
    )
    const current = playerDamage.get(playerName) ?? 0
    playerDamage.set(playerName, current + (battle.damageDealt ?? 0))
  }

  let topPerformer = 'N/A'
  let maxDamage = 0
  for (const [player, damage] of playerDamage.entries()) {
    if (damage > maxDamage) {
      maxDamage = damage
      topPerformer = player
    }
  }

  const topBattles: TopBattleEntry[] = [...battleData]
    .sort((a, b) => (b.damageDealt ?? 0) - (a.damageDealt ?? 0))
    .slice(0, 5)
    .map((battle) => ({
      player: relabelForDisplay(
        resolveDisplayName(battle.displayName, battle.userId, playerNameMap),
        labelMap
      ),
      guild: battle.Guild ?? 'Unknown Guild',
      boss: battle.Name ?? battle.type ?? 'Unknown Boss',
      damage: battle.damageDealt ?? 0
    }))

  return {
    total_damage: totalDamage,
    total_battles: totalBattles,
    active_players: uniquePlayers.size,
    unique_bosses: uniqueBosses.size,
    avg_damage:
      meaningfulBattles.length > 0
        ? Math.round(meaningfulDamage / meaningfulBattles.length)
        : 0,
    top_performer: relabelForDisplay(topPerformer, labelMap),
    top_damage: maxDamage,
    top_battles: topBattles,
    guilds_active: uniqueGuilds.size
  }
}

async function sendDailySummaryWebhook(
  supabase: SupabaseDailyClient,
  cluster: ClusterRow,
  stats: DailySummaryStats,
  date: Date
): Promise<WebhookResult> {
  try {
    const { data: webhookConfig } = await supabase
      .from('webhook_config')
      .select('webhook_url')
      .eq('cluster_id', cluster.id)
      // A cluster webhook must not be guild-scoped, or a dual-tagged row leaks cluster content into a guild.
      .is('guild_code', null)
      .eq('webhook_type', 'daily_summary')
      .eq('enabled', true)
      .single()

    if (!webhookConfig?.webhook_url) {
      return { success: false, error: 'No webhook configured' }
    }

    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })

    const fields = [
      {
        name: '📊 Battle Statistics',
        value: `**Total Battles:** ${stats.total_battles.toLocaleString()}\n**Total Damage:** ${stats.total_damage.toLocaleString()}\n**Average Damage:** ${stats.avg_damage.toLocaleString()}`,
        inline: true
      },
      {
        name: '👥 Participation',
        value: `**Active Players:** ${stats.active_players}\n**Active Guilds:** ${stats.guilds_active}\n**Unique Bosses:** ${stats.unique_bosses}`,
        inline: true
      },
      {
        name: '🏆 MVP of the Day',
        value: `**${stats.top_performer}**\n${stats.top_damage.toLocaleString()} total damage`,
        inline: false
      }
    ]

    if (stats.top_battles.length > 0) {
      const topBattlesList = stats.top_battles
        .map((battle, index) => {
          const medal =
            index === 0
              ? '🥇'
              : index === 1
                ? '🥈'
                : index === 2
                  ? '🥉'
                  : `${index + 1}.`
          return `${medal} **${battle.damage.toLocaleString()}** - ${battle.player} (${battle.guild}) vs ${battle.boss}`
        })
        .join('\n')
      fields.push({
        name: '⚔️ Top Battles',
        value: topBattlesList,
        inline: false
      })
    }

    const embed = {
      title: `📅 Daily Summary - ${cluster.display_name ?? cluster.cluster_code}`,
      description: `Summary for ${dateStr}`,
      color: 0x5865f2, // Discord blurple
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: `${cluster.display_name ?? cluster.cluster_code} Daily Report • Generated at 2:00 AM`
      }
    }

    // ignoreEnabledFlag: this site never checked the feature flag.
    const result = await sendWebhookMessage(
      webhookConfig.webhook_url,
      { embeds: [embed], username: 'Daily Summary Bot' },
      { ignoreEnabledFlag: true }
    )

    if (!result.success) {
      logger.error(`Failed to send daily summary: ${result.error}`)
      return { success: false, error: result.error ?? 'Webhook send failed' }
    }

    await supabase
      .from('webhook_config')
      .update({ last_tested: new Date().toISOString() })
      .eq('cluster_id', cluster.id)
      .eq('webhook_type', 'daily_summary')

    return { success: true }
  } catch (error) {
    const message = toErrorMessage(error)
    logger.error('Error sending daily summary:', error)
    return { success: false, error: message }
  }
}

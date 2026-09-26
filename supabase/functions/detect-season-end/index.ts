import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { logger } from '../_shared/logger.ts'
import {
  createServiceClient,
  type SupabaseClient
} from '../_shared/supabase-client.ts'
import { sendWebhookMessage, EmbedColors } from '../_shared/discord-webhook.ts'
import { isMeaningfulBattleRow } from '../_shared/damage-classification.ts'
import { corsOptionsResponse } from '../_shared/response-helpers.ts'

type SupabaseDbClient = SupabaseClient

type ClusterRow = {
  id: number
  cluster_code: string
  display_name: string | null
}

type BattleRow = {
  displayName: string
  damageDealt: number | null
  type: string | null
  encounterIndex: number | null
  damageType: string | null
  remainingHp: number | null
  maxHp: number | null
}

type SeasonStats = {
  total_damage: number
  total_battles: number
  active_players: number
  bosses_defeated: number
  avg_damage: number
  top_performer: string
  top_performer_damage: number
}

type SummaryResult =
  | { cluster: string; season: string; status: 'summary_sent' }
  | { cluster: string; season: string; status: 'failed'; error: string }
  | { cluster: string; season: string; status: 'active' }

type WebhookResult = { success: true } | { success: false; error: string }

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }
  try {
    const supabase = createServiceClient() as SupabaseDbClient

    const { data: clustersData, error: clustersError } = await supabase
      .from('clusters')
      .select('id, cluster_code, display_name')
      .eq('is_active', true)

    if (clustersError) {
      throw new Error(clustersError.message)
    }

    const clusters = (clustersData ?? []) as ClusterRow[]

    if (clusters.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    }

    const results: SummaryResult[] = []

    for (const cluster of clusters) {
      const currentSeason = await fetchLatestSeason(
        supabase,
        cluster.cluster_code
      )
      if (!currentSeason) {
        continue
      }

      const summaryTracked = await hasSeasonSummary(
        supabase,
        cluster.cluster_code,
        currentSeason
      )
      if (summaryTracked) {
        continue
      }

      const seasonEnded = await hasBattlesForSeason(
        supabase,
        cluster.cluster_code,
        incrementSeason(currentSeason)
      )

      if (!seasonEnded) {
        results.push({
          cluster: cluster.cluster_code,
          season: currentSeason,
          status: 'active'
        })
        continue
      }

      try {
        const stats = await generateSeasonSummary(
          supabase,
          cluster.cluster_code,
          currentSeason
        )
        const webhookResult = await sendSeasonSummary(
          supabase,
          cluster,
          currentSeason,
          stats
        )

        if (!webhookResult.success) {
          results.push({
            cluster: cluster.cluster_code,
            season: currentSeason,
            status: 'failed',
            error: webhookResult.error
          })
          continue
        }

        await supabase.from('season_summary_tracking').insert({
          cluster_code: cluster.cluster_code,
          season: currentSeason,
          summary_data: stats,
          sent_at: new Date().toISOString()
        })

        results.push({
          cluster: cluster.cluster_code,
          season: currentSeason,
          status: 'summary_sent'
        })
      } catch (error) {
        const message = getErrorMessage(error)
        results.push({
          cluster: cluster.cluster_code,
          season: currentSeason,
          status: 'failed',
          error: message
        })
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })
  } catch (error) {
    logger.error('Error in detect-season-end:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

async function fetchLatestSeason(
  supabase: SupabaseDbClient,
  clusterCode: string
): Promise<string | null> {
  // Order by numeric season_num: "Season" is TEXT and lex-sorts.
  const { data, error } = await supabase
    .from('EOT_GR_data')
    .select('Season')
    .eq('cluster_code', clusterCode)
    .order('season_num', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.Season ?? null
}

async function hasSeasonSummary(
  supabase: SupabaseDbClient,
  clusterCode: string,
  season: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('season_summary_tracking')
    .select('id')
    .eq('cluster_code', clusterCode)
    .eq('season', season)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw new Error(error.message)
  }

  return Boolean(data)
}

async function hasBattlesForSeason(
  supabase: SupabaseDbClient,
  clusterCode: string,
  season: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('EOT_GR_data')
    .select('Guild', { count: 'exact', head: true })
    .eq('cluster_code', clusterCode)
    .eq('Season', season)

  if (error) {
    throw new Error(error.message)
  }

  return (count ?? 0) > 0
}

function incrementSeason(season: string): string {
  const numeric = Number(season)
  return Number.isFinite(numeric) ? String(numeric + 1) : season
}

async function generateSeasonSummary(
  supabase: SupabaseDbClient,
  clusterCode: string,
  season: string
): Promise<SeasonStats> {
  const { data, error } = await supabase
    .from('EOT_GR_data')
    .select(
      'displayName, damageDealt, type, encounterIndex, damageType, remainingHp, maxHp'
    )
    .eq('cluster_code', clusterCode)
    .eq('Season', season)

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data ?? []) as BattleRow[]

  if (rows.length === 0) {
    return {
      total_damage: 0,
      total_battles: 0,
      active_players: 0,
      bosses_defeated: 0,
      avg_damage: 0,
      top_performer: 'N/A',
      top_performer_damage: 0
    }
  }

  const totalDamage = rows.reduce((sum, row) => sum + (row.damageDealt ?? 0), 0)
  const uniquePlayers = new Set(rows.map((row) => row.displayName))
  const uniqueBosses = new Set(
    rows.map((row) => `${row.type ?? 'Unknown'}_${row.encounterIndex ?? 0}`)
  )

  const playerDamage = new Map<string, number>()
  for (const battle of rows) {
    const current = playerDamage.get(battle.displayName) ?? 0
    playerDamage.set(battle.displayName, current + (battle.damageDealt ?? 0))
  }

  let topPerformer = 'N/A'
  let topDamage = 0
  for (const [player, damage] of playerDamage.entries()) {
    if (damage > topDamage) {
      topDamage = damage
      topPerformer = player
    }
  }

  // Per-battle average matches the web (Battle rows only, no crashes or sweeps); totals stay raw.
  const meaningfulBattles = rows.filter(isMeaningfulBattleRow)
  const meaningfulDamage = meaningfulBattles.reduce(
    (sum, row) => sum + (row.damageDealt ?? 0),
    0
  )

  return {
    total_damage: totalDamage,
    total_battles: rows.length,
    active_players: uniquePlayers.size,
    bosses_defeated: uniqueBosses.size,
    avg_damage:
      meaningfulBattles.length > 0
        ? Math.round(meaningfulDamage / meaningfulBattles.length)
        : 0,
    top_performer: topPerformer,
    top_performer_damage: topDamage
  }
}

async function sendSeasonSummary(
  supabase: SupabaseDbClient,
  cluster: ClusterRow,
  season: string,
  stats: SeasonStats
): Promise<WebhookResult> {
  try {
    const { data: webhookConfig, error: webhookError } = await supabase
      .from('webhook_config')
      .select('webhook_url')
      .eq('cluster_id', cluster.id)
      // A cluster webhook must not be guild-scoped, or a dual-tagged row leaks cluster content into a guild.
      .is('guild_code', null)
      .eq('webhook_type', 'season_summary')
      .eq('enabled', true)
      .maybeSingle()

    if (webhookError) {
      return { success: false, error: webhookError.message }
    }

    if (!webhookConfig?.webhook_url) {
      return { success: false, error: 'No webhook configured' }
    }

    const embed = {
      title: `?? Season ${season} Summary - ${cluster.display_name ?? cluster.cluster_code}`,
      description: `Season ${season} has ended! Here are the final statistics:`,
      color: 0x4b0082,
      fields: [
        {
          name: '?? Total Damage',
          value: stats.total_damage.toLocaleString(),
          inline: true
        },
        {
          name: '?? Total Battles',
          value: stats.total_battles.toLocaleString(),
          inline: true
        },
        {
          name: '?? Active Players',
          value: stats.active_players.toString(),
          inline: true
        },
        {
          name: '?? Unique Bosses',
          value: stats.bosses_defeated.toString(),
          inline: true
        },
        {
          name: '?? Avg Damage/Battle',
          value: stats.avg_damage.toLocaleString(),
          inline: true
        },
        {
          name: '?? Top Performer',
          value: `${stats.top_performer}\n${stats.top_performer_damage.toLocaleString()} total`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: `${cluster.display_name ?? cluster.cluster_code} Guild Raid Dashboard`
      }
    }

    // ignoreEnabledFlag: this site never checked the feature flag.
    const result = await sendWebhookMessage(
      webhookConfig.webhook_url,
      { embeds: [embed], username: 'Season Summary Bot' },
      { ignoreEnabledFlag: true }
    )

    if (!result.success) {
      logger.error(`Failed to send season summary: ${result.error}`)
      return { success: false, error: result.error ?? 'Webhook send failed' }
    }

    await supabase
      .from('webhook_config')
      .update({ last_tested: new Date().toISOString() })
      .eq('cluster_id', cluster.id)
      .eq('webhook_type', 'season_summary')

    return { success: true }
  } catch (error) {
    const message = getErrorMessage(error)
    logger.error('Error sending season summary:', error)
    return { success: false, error: message }
  }
}

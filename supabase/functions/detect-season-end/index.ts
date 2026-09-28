import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { logger } from '../_shared/logger.ts'
import {
  createServiceClient,
  type SupabaseClient
} from '../_shared/supabase-client.ts'
import { sendWebhookMessage, EmbedColors } from '../_shared/discord-webhook.ts'
import { corsOptionsResponse } from '../_shared/response-helpers.ts'
import { hasSeasonEnded } from './season-end-guard.ts'

type SupabaseDbClient = SupabaseClient

type ClusterRow = {
  id: number
  cluster_code: string
  display_name: string | null
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

      const seasonId = Number(currentSeason)
      const endsAt = Number.isFinite(seasonId)
        ? await fetchSeasonEndsAt(supabase, seasonId)
        : null
      const seasonEnded = hasSeasonEnded(Date.now(), endsAt)

      if (!seasonEnded) {
        results.push({
          cluster: cluster.cluster_code,
          season: currentSeason,
          status: 'active'
        })
        continue
      }

      // Claim this (cluster, season) before doing any work. The unique
      // constraint on (cluster_code, season) means only one concurrent
      // run's insert can land, so two overlapping runs cannot both post.
      const claimed = await claimSeasonSummary(
        supabase,
        cluster.cluster_code,
        currentSeason
      )
      if (!claimed) {
        continue // a concurrent (or earlier, still-pending) run already claimed it
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
          await releaseSeasonSummaryClaim(
            supabase,
            cluster.cluster_code,
            currentSeason
          )
          results.push({
            cluster: cluster.cluster_code,
            season: currentSeason,
            status: 'failed',
            error: webhookResult.error
          })
          continue
        }

        const { error: completeError } = await supabase
          .from('season_summary_tracking')
          .update({
            summary_data: stats,
            sent_at: new Date().toISOString()
          })
          .eq('cluster_code', cluster.cluster_code)
          .eq('season', currentSeason)
        if (completeError) {
          // The Discord message is already out; don't undo that by treating
          // this as a send failure. The claim row is left as-is (unsent) --
          // within the stale window that still blocks a duplicate send, same
          // as a concurrent run would.
          logger.error(
            `Error marking season summary sent for ${cluster.cluster_code}/${currentSeason}:`,
            completeError.message
          )
        }

        results.push({
          cluster: cluster.cluster_code,
          season: currentSeason,
          status: 'summary_sent'
        })
      } catch (error) {
        await releaseSeasonSummaryClaim(
          supabase,
          cluster.cluster_code,
          currentSeason
        )
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
  // Only a genuinely completed row (sent_at set) short-circuits here. An
  // unsent row is a claim, possibly abandoned by a crashed run; whether it's
  // still live or stale enough to reclaim is claim_season_summary's call,
  // not this cheap pre-check's -- treating any row as "done" would leave an
  // abandoned claim blocking this season forever.
  const { data, error } = await supabase
    .from('season_summary_tracking')
    .select('id')
    .eq('cluster_code', clusterCode)
    .eq('season', season)
    .not('sent_at', 'is', null)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw new Error(error.message)
  }

  return Boolean(data)
}

async function fetchSeasonEndsAt(
  supabase: SupabaseDbClient,
  seasonId: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from('season_calendar')
    .select('ends_at')
    .eq('season_id', seasonId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.ends_at ?? null
}

async function claimSeasonSummary(
  supabase: SupabaseDbClient,
  clusterCode: string,
  season: string
): Promise<boolean> {
  // A plain insert-then-check-later here would let two overlapping runs
  // both pass hasSeasonSummary before either claims; claim_season_summary
  // does the claim and the "is this claim fresh or abandoned" decision in
  // one statement, using UNIQUE(cluster_code, season) as the arbiter.
  const { data, error } = await supabase.rpc('claim_season_summary', {
    p_cluster_code: clusterCode,
    p_season: season
  })

  if (error) {
    throw new Error(error.message)
  }
  return data === true
}

async function releaseSeasonSummaryClaim(
  supabase: SupabaseDbClient,
  clusterCode: string,
  season: string
): Promise<void> {
  // Only ever remove our own not-yet-sent claim, never a completed row.
  await supabase
    .from('season_summary_tracking')
    .delete()
    .eq('cluster_code', clusterCode)
    .eq('season', season)
    .is('sent_at', null)
}

async function generateSeasonSummary(
  supabase: SupabaseDbClient,
  clusterCode: string,
  season: string
): Promise<SeasonStats> {
  // Aggregated server-side (get_season_summary_stats): a plain select of raw
  // rows is capped by PostgREST's max_rows and would silently truncate the
  // totals for any cluster-season above that size.
  const { data, error } = await supabase
    .rpc('get_season_summary_stats', {
      p_cluster_code: clusterCode,
      p_season: season
    })
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  const stats = data as {
    total_damage: number | null
    total_battles: number | null
    active_players: number | null
    bosses_defeated: number | null
    avg_damage: number | null
    top_performer: string | null
    top_performer_damage: number | null
  } | null

  return {
    total_damage: stats?.total_damage ?? 0,
    total_battles: stats?.total_battles ?? 0,
    active_players: stats?.active_players ?? 0,
    bosses_defeated: stats?.bosses_defeated ?? 0,
    avg_damage: stats?.avg_damage ?? 0,
    top_performer: stats?.top_performer ?? 'N/A',
    top_performer_damage: stats?.top_performer_damage ?? 0
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

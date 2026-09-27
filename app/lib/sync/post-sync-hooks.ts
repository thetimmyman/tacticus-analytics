import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.sync.post-sync-hooks')
import type { GuildConfig } from '@tacticus/app-core/types'
import { resolveLokiIdentity } from '@/app/lib/loki/identity'
import {
  fetchGuildMembersViaLoki,
  fetchGuildRankings,
  type LokiFetchResult
} from '@/app/lib/sync/api-operations'
import { getSeasonTiming } from '@/app/lib/services/season-timing-service'
import { invalidateGuildCache } from '@/app/lib/api/cached-responses'
import type { ServiceSupabaseClient } from './worker-types'
import { MIN_REQUIRED_SEASONS, HISTORY_LOOKBACK_SEASONS } from './worker-types'
import { callRpc } from './worker-utils'
import { readGuildSeasons } from '@/supabase/functions/_shared/guild-seasons'
import { planHistoricalSeasons } from '@/supabase/functions/historical-backfill-modular/planning'
import { handleDuplicateDisplayNames } from '@/app/lib/sync/transformers'
import { reconcileGuildRoles } from '@/app/lib/discord/role-reconciler'
import { evaluateAndPersistAchievements } from '@/app/lib/achievements/persist'
import {
  beginGuildRosterObservation,
  savePlayerMappings
} from '@/app/lib/sync/db-operations'
import type { TablesUpdate } from '@tacticus/app-core/database.generated'

async function requestClusterRankingsRefresh(
  supabase: ServiceSupabaseClient
): Promise<void> {
  try {
    const { error } = await callRpc(supabase, 'refresh_cluster_rankings')
    if (error) {
      throw error
    }
  } catch (err) {
    logger.warn({ error: err }, 'Cluster rankings refresh failed (non-fatal)')
  }
}

interface LokiRosterContext {
  guildId: string
  userId: string
  sessionId: string
  clientSecret: string
  authFailed: boolean
}

async function markRosterRefreshed(
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<void> {
  const { error } = await supabase
    .from('guild_config')
    .update({ last_roster_refresh_at: new Date().toISOString() })
    .eq('guild_code', guildCode)
  if (error) {
    logger.warn(
      { guildCode, err: error.message },
      'Could not stamp last_roster_refresh_at (non-fatal)'
    )
  }
}

/** Also the authority path: savePlayerMappings deactivates departed members. Null without a LOKI identity. */
export async function refreshGuildRoster(
  guildCode: string,
  config: GuildConfig,
  supabase: ServiceSupabaseClient
): Promise<LokiRosterContext | null> {
  // The env scraper id wins over a legacy per-guild `guild_config.user_id` (it must match the shared secret).
  const { guild_id } = config
  const resolvedClientSecret = process.env.LOKI_SCRAPER_CLIENT_SECRET ?? null
  const identity = resolveLokiIdentity(config)
  const resolvedUserId = identity.userId
  let session_id: string = identity.sessionId
  if (identity.overrodeLegacyRow) {
    // Self-heal: CONNECT once with a blank session and join the shared cohort.
    logger.warn(
      { guildCode },
      'guild_config.user_id is a legacy per-guild LOKI identity; using the server-managed scraper id and clearing the legacy columns'
    )
    // Clear together: a trigger rejects nulling user_id without client_secret.
    const { error: clearError } = await supabase
      .from('guild_config')
      .update({
        user_id: null,
        session_id: null,
        client_secret: null,
        client_secret_uploaded_by: null,
        client_secret_uploaded_at: null,
        updated_at: new Date().toISOString()
      } as TablesUpdate<'guild_config'>)
      .eq('guild_code', guildCode)
    if (clearError) {
      logger.warn(
        { guildCode, err: clearError.message },
        'Could not clear legacy LOKI identity columns; will CONNECT again next run'
      )
    }
    session_id = ''
  }
  if (!guild_id || !resolvedUserId || !resolvedClientSecret) return null
  let lokiAuthFailed = false
  {
    try {
      const rosterObservedAt = await beginGuildRosterObservation(supabase)
      const lokiResult: LokiFetchResult = await fetchGuildMembersViaLoki(
        guildCode,
        guild_id,
        resolvedUserId,
        session_id ?? '',
        resolvedClientSecret,
        supabase
      )
      lokiAuthFailed = lokiResult.authFailed

      // Circuit breaker: clearing session_id stops retry amplification.
      if (lokiAuthFailed) {
        logger.warn(
          { guildCode },
          'Loki auth failed; clearing session to stop retry amplification'
        )
        await supabase
          .from('guild_config')
          .update({ session_id: null, updated_at: new Date().toISOString() })
          .eq('guild_code', guildCode)
      }

      // Disambiguate before the upsert as other writers do: LOKI omits
      // `hasDuplicateName`, and the suffix is a join key. Numbering is deterministic.
      const lokiMembers = handleDuplicateDisplayNames(
        lokiResult.members,
        guildCode
      )
      if (lokiMembers.length > 0) {
        // Never a parallel upsert: heterogeneous-key bulk payloads make PostgREST
        // NULL missing keys, wiping linked identity. savePlayerMappings owns
        // is_current/is_active, the activity guard, the breaker and transfers.
        await savePlayerMappings(
          supabase,
          guildCode,
          lokiMembers,
          null,
          {
            cluster_code: config.cluster_code ?? null,
            cluster_id: config.cluster_id ?? null
          },
          rosterObservedAt
        )
      }
    } catch (err) {
      logger.warn(
        { err, guildCode },
        'LOKI player-name sync failed (non-fatal)'
      )
    }
    // Stamp failures too, so a failing guild is throttled.
    await markRosterRefreshed(supabase, guildCode)
  }
  return {
    guildId: guild_id,
    userId: resolvedUserId,
    sessionId: session_id ?? '',
    clientSecret: resolvedClientSecret,
    authFailed: lokiAuthFailed
  }
}

/** Failures are logged and never fail the sync job. */
export async function runPostSyncHooks(
  guildCode: string,
  season: string,
  config: GuildConfig,
  supabase: ServiceSupabaseClient
): Promise<void> {
  const clusterCode = config.cluster_code ?? null

  try {
    await callRpc(supabase, 'update_token_burn_state_for_guild', {
      p_guild_code: guildCode,
      p_season: season
    })
  } catch (err) {
    logger.warn(
      { err, guildCode },
      'Token burn state update failed (non-fatal)'
    )
  }

  // The database owns the throttle; an app-side window would double the interval.
  await requestClusterRankingsRefresh(supabase)

  const functionName = `update-discord-leaderboards?guild=${encodeURIComponent(guildCode)}`
  supabase.functions
    .invoke(functionName, {
      body: { cluster_code: clusterCode || null }
    })
    .catch((err: unknown) => {
      logger.warn(
        { err, guildCode },
        'Discord leaderboard update failed (non-fatal)'
      )
    })

  reconcileGuildRoles(supabase, guildCode, {
    trigger_source: 'post_sync'
  }).catch((err: unknown) => {
    logger.warn(
      { err, guildCode },
      'Role reconciler post-sync hook failed (non-fatal)'
    )
  })

  const loki = await refreshGuildRoster(guildCode, config, supabase)
  if (loki) {
    if (loki.authFailed) {
      logger.info(
        { guildCode },
        'Skipping rankings fetch after Loki auth failure'
      )
    } else
      try {
        const rankings = await fetchGuildRankings(
          guildCode,
          loki.guildId,
          loki.userId,
          loki.sessionId,
          loki.clientSecret,
          supabase
        )
        const updates: Record<string, unknown> = {}
        if (rankings.guildRaid !== null) updates.GR_Ranking = rankings.guildRaid
        if (rankings.guildWar !== null) updates.GW_Ranking = rankings.guildWar
        if (Object.keys(updates).length > 0) {
          await supabase
            .from('guild_config')
            .update(updates as TablesUpdate<'guild_config'>)
            .eq('guild_code', guildCode)
          logger.info(
            {
              guildCode,
              guildRaidRanking: rankings.guildRaid,
              guildWarRanking: rankings.guildWar
            },
            'Guild rankings updated'
          )
        }
      } catch (err) {
        logger.warn(
          { err, guildCode },
          'Guild rankings sync failed (non-fatal)'
        )
      }
  }

  // Usually a no-op: `apiCache` is per-process in web pods, so dashboards rely on the TTL.
  invalidateGuildCache(guildCode, season).catch((err: unknown) => {
    logger.warn(
      { err, guildCode },
      'Guild cache invalidation failed (non-fatal)'
    )
  })

  evaluateAndPersistAchievements(supabase, guildCode).catch((err: unknown) => {
    logger.warn({ err, guildCode }, 'Achievement evaluation failed (non-fatal)')
  })

  try {
    const seasonNum = parseInt(season)
    if (!isNaN(seasonNum) && seasonNum > 0) {
      const timing = await getSeasonTiming(seasonNum)
      await supabase.from('season_calendar').upsert(
        {
          season_id: seasonNum,
          season_label: `Season ${seasonNum}`,
          starts_at: new Date(timing.seasonStart).toISOString(),
          ends_at: new Date(timing.seasonEnd).toISOString(),
          tokens_per_player_cap: 28,
          regen_interval_hours: 12,
          regen_tokens_per_interval: 1
        },
        { onConflict: 'season_id' }
      )
    }
  } catch (err) {
    logger.warn({ err, guildCode }, 'Season calendar sync failed (non-fatal)')
  }
}

/** Queues replays for recent historical gaps. Never deletes seasons. */
export async function checkSeasonCoverage(
  guildCode: string,
  currentSeason: number,
  supabase: ServiceSupabaseClient
): Promise<void> {
  try {
    if (!Number.isSafeInteger(currentSeason) || currentSeason <= 0) {
      throw new Error('Cannot assess coverage without a valid season')
    }
    const uniqueSeasons = await readGuildSeasons(async () =>
      supabase.rpc('get_distinct_seasons_for_guild', { p_guild: guildCode })
    )
    const missingSeasons = planHistoricalSeasons({
      currentSeason,
      existingSeasons: uniqueSeasons,
      maxSeasons: MIN_REQUIRED_SEASONS,
      lookbackSeasons: HISTORY_LOOKBACK_SEASONS
    })
    if (missingSeasons.length > 0) {
      // Shared with the edge producer: suppresses concurrent work and completed
      // empty-season probes until the next UTC day.
      const dedupeKey = `guild_historical_backfill:${guildCode}:${currentSeason}:${missingSeasons.join(',')}:${new Date().toISOString().slice(0, 10)}`
      const { data: completed, error: completedError } = await supabase
        .from('work_queue')
        .select('id')
        .eq('dedupe_key', dedupeKey)
        .eq('status', 'completed')
        .limit(1)
        .maybeSingle()
      if (completedError) throw new Error('Cannot check historical completion')
      if (!completed) {
        const { error } = await supabase.from('work_queue').insert({
          job_type: 'guild_historical_backfill',
          job_class: 'batch',
          payload: { guild_code: guildCode, force_seasons: missingSeasons },
          scheduled_for: new Date(Date.now() + 30_000).toISOString(),
          dedupe_key: dedupeKey
        })
        if (error && error.code !== '23505')
          throw new Error('Historical backfill enqueue failed')
      }
    }
  } catch (err) {
    logger.warn(
      { err, guildCode },
      'Season coverage check failed; retry required'
    )
    throw err
  }
}

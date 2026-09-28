import { loadPlayerNameMap } from '../_shared/player-name-resolution.ts'
import { corsHeaders } from '../_shared/cors-headers.ts'
import { jsonResponse } from '../_shared/response-helpers.ts'
import { logger } from '../_shared/logger.ts'
import {
  createServiceClient,
  type SupabaseClient
} from '../_shared/supabase-client.ts'
// Award math comes from the same SQL RPCs the VOTLW page reads, so the two cannot drift.
import {
  type RpcSetWinnerRow,
  type SeasonAwardsDataRow,
  calculateSeasonAwards,
  calculatePlayerPoints
} from './votlw-core.ts'
import {
  VOTLW_LOOKBACK_SEASONS,
  buildGuildSeasonRows,
  computeManualGuildTarget,
  normalizeManualSeason,
  selectScorableSeasons,
  seasonsWithWrittenWinners
} from './season-guard.ts'

// Untyped on purpose: the edge image has only supabase/functions, so an
// app-core type import fails at boot (scripts/dev/check-edge-imports.mjs).
type SupabaseDbClient = SupabaseClient

type VotlwTarget = { guild: string; season: string }
type VotlwWinner = {
  player: string
  totalPoints: number
  goldMedals: number
  silverMedals: number
  bronzeMedals: number
}
type VotlwResult = {
  guild: string
  season: string
  winner: string
  points: number
  written: boolean
  error?: string
}

async function calculateVOTLW(
  supabase: SupabaseDbClient,
  guildCode: string,
  season: string,
  playerNameMap: Map<string, string>
): Promise<VotlwWinner | null> {
  // Pass cluster_code to both RPCs, as useVOTLWData does, or the surfaces disagree.
  const { data: guildConfig, error: guildConfigError } = await supabase
    .from('guild_config')
    .select('cluster_code')
    .eq('guild_code', guildCode)
    .maybeSingle<{ cluster_code: string | null }>()
  if (guildConfigError) {
    // A silently-undefined cluster_code here used to fall through as "no
    // cluster filter" instead of surfacing the DB error.
    throw guildConfigError
  }
  const clusterCode = guildConfig?.cluster_code ?? undefined

  // Legendary and Mythic, with sweep rules and 2-battle gates.
  const { data: setWinnersData, error: setWinnersError } = await supabase.rpc(
    'get_votlw_set_winners',
    {
      p_guild_code: guildCode,
      p_season: season,
      p_cluster_code: clusterCode
    }
  )
  if (setWinnersError) {
    throw setWinnersError
  }
  const setResults = (setWinnersData ?? []) as RpcSetWinnerRow[]
  if (setResults.length === 0) {
    return null
  }

  const { data: seasonPayload, error: seasonPayloadError } = await supabase.rpc(
    'get_votlw_season_awards_data',
    {
      p_guild_code: guildCode,
      p_season: season,
      p_cluster_code: clusterCode
    }
  )
  if (seasonPayloadError) {
    throw seasonPayloadError
  }
  const payload = (seasonPayload ?? {}) as {
    last_hits?: SeasonAwardsDataRow[] | null
    bomb_data?: SeasonAwardsDataRow[] | null
  }

  const seasonResults = calculateSeasonAwards(
    payload.last_hits ?? [],
    payload.bomb_data ?? [],
    playerNameMap
  )
  const finalPoints = calculatePlayerPoints(setResults, seasonResults)
  const winner = finalPoints[0]
  if (winner) {
    const { error: insertError } = await supabase.from('votlw_winners').upsert({
      guild_code: guildCode,
      season: season,
      winner_name: winner.player,
      total_points: winner.totalPoints,
      gold_medals: winner.goldMedals,
      silver_medals: winner.silverMedals,
      bronze_medals: winner.bronzeMedals,
      kill_bonus_points:
        seasonResults.topKiller.player === winner.player ? 3 : 0,
      bomb_bonus_points:
        seasonResults.bestBomber.player === winner.player ? 0.5 : 0,
      calculated_at: new Date().toISOString()
    })
    if (insertError) {
      logger.error(`Error storing winner:`, insertError.message)
      throw insertError
    }
  }
  return winner
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    })
  }
  try {
    const supabase = createServiceClient()
    const body = req.method === 'POST' ? await req.json() : {}
    const { season: rawSeason, guild: specificGuild, source } = body

    const seasonCheck = normalizeManualSeason(rawSeason)
    if (seasonCheck && 'error' in seasonCheck) {
      return jsonResponse({ error: seasonCheck.error }, { status: 400 })
    }
    const canonicalSeason =
      seasonCheck && 'season' in seasonCheck ? seasonCheck.season : null

    const playerNameMap = await loadPlayerNameMap(supabase)
    logger.info(
      '[calculate-votlw]',
      `Loaded ${playerNameMap.size / 2} player name mappings (source=${source ?? 'unspecified'})`
    )

    let targets: VotlwTarget[] = []

    if (canonicalSeason) {
      // Manual/explicit invocation (e.g. a one-off correction re-run): honor
      // exactly what was asked for, no ended/grace guard. The validated,
      // trimmed string flows unchanged to guild discovery, both award RPCs,
      // and the upsert below — never re-parsed.
      if (specificGuild) {
        targets = [{ guild: specificGuild, season: canonicalSeason }]
      } else {
        // Aggregated server-side (one row per guild): a plain select of raw
        // battle rows hits PostgREST's row cap well before covering a whole
        // season's guilds and silently truncates.
        const { data: guildRows, error } = await supabase.rpc(
          'get_votlw_guilds_for_season',
          { p_season: canonicalSeason }
        )
        if (error) {
          logger.error(
            `Error fetching guilds for season ${canonicalSeason}:`,
            error.message
          )
          return jsonResponse({ error: error.message }, { status: 502 })
        }
        const uniqueGuilds = [
          ...new Set(
            ((guildRows as Array<{ guild_code: string }> | null) ?? []).map(
              (row) => row.guild_code
            )
          )
        ]
        targets = uniqueGuilds.map((guild) => ({
          guild,
          season: canonicalSeason
        }))
      }
    } else if (specificGuild) {
      // Manual call naming only a guild (calculate_votlw_for_season(NULL,
      // guild)): score that guild's own previous season directly, from its
      // own latest season — no grace window, unlike the scheduled path
      // below. An explicit manual call already knows what it wants scored.
      const { data: latestSeasonForGuild, error } = await supabase.rpc(
        'get_latest_season_for_guild',
        { p_guild: specificGuild }
      )
      if (error) {
        logger.error(
          `Error fetching latest season for ${specificGuild}:`,
          error.message
        )
        return jsonResponse({ error: error.message }, { status: 502 })
      }
      const target = computeManualGuildTarget(
        specificGuild,
        latestSeasonForGuild as string | null
      )
      targets = target
        ? [{ guild: target.guild, season: target.season.toString() }]
        : []
    } else {
      // Scheduled run: score a guild's season only once that guild's OWN data
      // shows it ended, with a grace window for late-syncing battles. Never
      // derive "which season ended" from a single global max season number:
      // guilds/clusters advance on independent calendars, so one guild racing
      // ahead used to make every other guild's still-open season look past
      // and get scored from a sliver of its data.
      const { data: maxSeasonData, error: maxSeasonError } =
        await supabase.rpc('get_latest_season')
      if (maxSeasonError) {
        logger.error('Error fetching latest season:', maxSeasonError.message)
        return jsonResponse({ error: maxSeasonError.message }, { status: 502 })
      }
      const globalLatestSeason = maxSeasonData
        ? parseInt(maxSeasonData, 10)
        : null
      if (globalLatestSeason !== null) {
        // One extra season below the lookback window so a guild sitting
        // right at its edge still has its own previous-season row fetched.
        const lookbackFloor = Math.max(
          1,
          globalLatestSeason - VOTLW_LOOKBACK_SEASONS - 1
        )
        // Aggregated server-side (one row per guild/season): a plain select
        // of raw battle rows hits PostgREST's row cap long before covering a
        // whole season's guilds and silently truncates.
        const { data: rows, error } = await supabase.rpc(
          'get_votlw_guild_season_first_battle',
          { p_min_season: lookbackFloor }
        )
        if (error) {
          logger.error(`Error fetching guild season windows:`, error.message)
          return jsonResponse({ error: error.message }, { status: 502 })
        }
        const guildSeasonRows = buildGuildSeasonRows(
          (rows ?? []) as Array<{
            guild_code: string | null
            season: number | null
            first_battle: string | null
          }>
        )
        targets = selectScorableSeasons(guildSeasonRows, Date.now()).map(
          (t) => ({ guild: t.guild, season: t.season.toString() })
        )
      }
    }

    const results: VotlwResult[] = []
    for (const { guild, season } of targets) {
      try {
        const winner = await calculateVOTLW(
          supabase,
          guild,
          season,
          playerNameMap
        )
        results.push({
          guild,
          season,
          winner: winner?.player || 'None',
          points: winner?.totalPoints || 0,
          written: Boolean(winner)
        })
      } catch (error) {
        logger.error(`Failed to calculate for ${guild}:`, error)
        results.push({
          guild,
          season,
          winner: 'None',
          points: 0,
          written: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // Keep explore cards and champion counts current after any write.
    // refresh_public_guild_snapshots alone: it derives votlw_stats straight
    // from votlw_winners. Deliberately not refresh_guild_snapshots(season)
    // first -- that TRUNCATEs the same table for one arbitrary season
    // without votlw-shaped data, a readable broken state if the next call
    // then failed. Best effort: logged, not folded into this response.
    if (seasonsWithWrittenWinners(results).length > 0) {
      const { error } = await supabase.rpc('refresh_public_guild_snapshots')
      if (error) {
        logger.error('Error refreshing public guild snapshots:', error.message)
      }
    }

    const anyErrors = results.some((result) => 'error' in result)
    return jsonResponse(
      {
        success: !anyErrors,
        results,
        processed: results.length
      },
      { status: anyErrors ? 500 : 200 }
    )
  } catch (error) {
    logger.error('Error in VOTLW calculation:', error)
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})

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

// Untyped on purpose: the edge image has only supabase/functions, so an
// app-core type import fails at boot (scripts/dev/check-edge-imports.mjs).
type SupabaseDbClient = SupabaseClient

async function calculateVOTLW(
  supabase: SupabaseDbClient,
  guildCode: string,
  season: string,
  playerNameMap: Map<string, string>
) {
  // Pass cluster_code to both RPCs, as useVOTLWData does, or the surfaces disagree.
  const { data: guildConfig } = await supabase
    .from('guild_config')
    .select('cluster_code')
    .eq('guild_code', guildCode)
    .maybeSingle<{ cluster_code: string | null }>()
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
    const { season: specificSeason, guild: specificGuild } = body

    const playerNameMap = await loadPlayerNameMap(supabase)
    logger.info(
      '[calculate-votlw]',
      `Loaded ${playerNameMap.size / 2} player name mappings`
    )

    let seasonsToProcess: string[] = []
    if (specificSeason) {
      seasonsToProcess = [specificSeason]
    } else {
      // Previous season. "Season" is TEXT, so use the numeric RPC, not MAX.
      const { data: maxSeasonData } = await supabase.rpc('get_latest_season')
      if (maxSeasonData) {
        const currentSeason = parseInt(maxSeasonData, 10)
        const previousSeason = (currentSeason - 1).toString()
        seasonsToProcess = [previousSeason]
      }
    }
    const results = []
    for (const season of seasonsToProcess) {
      // No rarity filter: Mythic-only participation counts.
      let guildsQuery = supabase
        .from('EOT_GR_data')
        .select('Guild')
        .eq('Season', season)
        .gte('tier', 4)
      if (specificGuild) {
        guildsQuery = guildsQuery.eq('Guild', specificGuild)
      }
      const { data: guilds, error } = await guildsQuery
      if (error || !guilds) {
        logger.error(`Error fetching guilds:`, error?.message)
        continue
      }
      const uniqueGuilds = [
        ...new Set((guilds as Array<{ Guild: string }>).map((g) => g.Guild))
      ]
      for (const guild of uniqueGuilds) {
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
            points: winner?.totalPoints || 0
          })
        } catch (error) {
          logger.error(`Failed to calculate for ${guild}:`, error)
          results.push({
            guild,
            season,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }
    return jsonResponse(
      {
        success: true,
        results,
        processed: results.length
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('Error in VOTLW calculation:', error)
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})

import { PUBLIC_LOKI_INSTALL_ID } from '@/app/lib/loki/public-device'
import { currentGwSeason } from '@tacticus/app-core/gw-season'
import {
  buildGwSeasonsToTry,
  isPersistableGuildRanking,
  MAX_VALID_GUILD_RANKING
} from '@tacticus/app-core/gw-ranking-policy'
import type { Database as SupabaseDatabase } from '@tacticus/app-core/database.generated'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  CONFIG,
  fetchWithCircuitBreaker,
  getErrorMessage,
  logger
} from './api-client'
import {
  type LokiApiResult,
  refreshSessionId,
  shouldRefreshSession,
  updateSessionIdInDatabase,
  validateAndRefreshSession
} from './loki-session-api'

type StrictSupabaseClient = TypedSupabaseClient
type GuildConfigRow =
  SupabaseDatabase['public']['Tables']['guild_config']['Row']

export type GuildRankings = {
  guildRaid: number | null
  guildWar: number | null
}

type RankingData = {
  eventResult?: {
    eventResponseData?: {
      leaderboard?: {
        guildPosition?: number
        season?: string
        top?: Array<{
          guildTag?: string
          guildId?: string
          [key: string]: unknown
        }>
      }
    }
  }
}

export async function fetchGuildRankings(
  guildCode: string,
  guildId: string,
  userId: string,
  sessionId: string,
  clientSecret: string,
  supabase: StrictSupabaseClient
): Promise<GuildRankings> {
  const rankings: GuildRankings = {
    guildRaid: null,
    guildWar: null
  }
  let successfulGWSeason: number | null = null

  sessionId = await validateAndRefreshSession(
    guildCode,
    userId,
    sessionId,
    clientSecret,
    supabase
  )

  async function fetchRanking(
    type: 'GUILD_RAID' | 'GUILD_WAR',
    currentSessionId: string,
    gwSeason: number | null = null
  ): Promise<LokiApiResult<RankingData>> {
    const url = `${CONFIG.api.lokiUrl}/player/player2/userId/${userId}/sessionId/${currentSessionId}`

    let payload: Record<string, unknown>
    if (type === 'GUILD_RAID') {
      payload = {
        playerEvent: {
          playerEventType: 'GET_GUILD_SEASON_LEADERBOARD',
          playerEventData: {
            guildId: guildId
          },
          universeVersion: 'universe_not_needed',
          gameConfigVersion: '9517a7dd237edad05a86e948e469c631',
          createdOn: Date.now().toString(),
          multiConfigVersion: ''
        },
        builtInMultiConfigVersion: '',
        installId: PUBLIC_LOKI_INSTALL_ID
      }
    } else {
      payload = {
        playerEvent: {
          playerEventType: 'GET_GUILD_WAR_LEADERBOARD',
          playerEventData: {
            guildId: guildId,
            season: gwSeason
          },
          universeVersion: 'universe_not_needed',
          gameConfigVersion: '9517a7dd237edad05a86e948e469c631',
          createdOn: Date.now().toString(),
          multiConfigVersion: ''
        },
        builtInMultiConfigVersion: '',
        installId: PUBLIC_LOKI_INSTALL_ID
      }
    }

    try {
      const response = await fetchWithCircuitBreaker(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: '*/*',
            'User-Agent':
              'UnityPlayer/2022.3.40f1 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)',
            'X-Unity-Version': '2022.3.40f1'
          },
          body: JSON.stringify(payload)
        },
        2,
        10000
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, status: response.status, error: errorText }
      }

      const data = await response.json()
      return { success: true, data }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  function extractRanking(
    data: RankingData | undefined,
    type: 'GUILD_RAID' | 'GUILD_WAR' = 'GUILD_WAR'
  ): { rank: number; season: string } | null {
    try {
      const leaderboard = data?.eventResult?.eventResponseData?.leaderboard
      if (!leaderboard) return null

      const seasonValue = String(leaderboard.season ?? 'Unknown')

      // GUILD_RAID ranks by top[] order: guildPosition returns ties and day-off garbage.
      if (type === 'GUILD_RAID') {
        const top = leaderboard.top || []
        const guildIndex = top.findIndex((g) => g.guildTag === guildCode)
        if (guildIndex >= 0) {
          return { rank: guildIndex + 1, season: seasonValue }
        }
      }

      if (typeof leaderboard.guildPosition === 'number') {
        return {
          rank: leaderboard.guildPosition + 1,
          season: seasonValue
        }
      }
      return null
    } catch (error: unknown) {
      logger.error(
        { guildCode },
        `Error extracting ranking: ${getErrorMessage(error)}`
      )
      return null
    }
  }

  async function batchUpdateRaidRankings(
    data: RankingData | undefined
  ): Promise<void> {
    try {
      const top = data?.eventResult?.eventResponseData?.leaderboard?.top || []
      if (top.length === 0) return

      const MAX_VALID_RANKING_BATCH = 10000
      const updates: { guildTag: string; rank: number }[] = []
      for (let i = 0; i < top.length; i++) {
        const guild = top[i]
        if (!guild) continue
        const rank = i + 1
        if (guild.guildTag && rank <= MAX_VALID_RANKING_BATCH) {
          updates.push({ guildTag: guild.guildTag, rank })
        }
      }

      // One batched RPC: a per-guild PATCH fanout exhausts the PostgREST pool.
      const payload = updates.map(({ guildTag, rank }) => ({
        guild_tag: guildTag,
        rank
      }))
      const { data: updatedCount, error: rpcError } = await supabase.rpc(
        'update_guild_rankings_batch',
        { p_rankings: payload }
      )
      if (rpcError) {
        logger.warn(
          { guildCode, attempted: updates.length, error: rpcError.message },
          'update_guild_rankings_batch RPC failed'
        )
        return
      }

      logger.info(
        { guildCode, attempted: updates.length, updated: updatedCount },
        'Batch-updated GR_Ranking via update_guild_rankings_batch RPC'
      )
    } catch (error: unknown) {
      logger.warn(
        { guildCode },
        `Failed to batch-update raid rankings: ${getErrorMessage(error)}`
      )
    }
  }

  try {
    logger.info({ guildCode }, 'Fetching Guild Raid ranking')

    let result = await fetchRanking('GUILD_RAID', sessionId)

    if (shouldRefreshSession(result, clientSecret)) {
      logger.info({ guildCode }, 'Refreshing session for GR ranking fetch')
      const newSessionId = await refreshSessionId(
        guildCode,
        userId,
        clientSecret
      )
      if (newSessionId) {
        await updateSessionIdInDatabase(supabase, guildCode, newSessionId)
        sessionId = newSessionId
        result = await fetchRanking('GUILD_RAID', newSessionId)
      } else {
        logger.error(
          { guildCode },
          'GR ranking: session refresh failed — credentials likely invalid'
        )
        return rankings // bail early, skip GW probe too
      }
    }

    if (result.success) {
      const rankingData = extractRanking(result.data, 'GUILD_RAID')
      if (rankingData) {
        rankings.guildRaid = rankingData.rank
        logger.info(
          { guildCode },
          `Guild Raid ranking: ${rankings.guildRaid} (Season ${rankingData.season})`
        )
      }
      await batchUpdateRaidRankings(result.data)
    } else {
      logger.warn(
        { guildCode },
        `Guild Raid ranking fetch failed: ${result.error || 'Unknown error'}`
      )
    }
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `Failed to fetch GR ranking: ${getErrorMessage(error)}`
    )
  }

  try {
    logger.info({ guildCode }, 'Fetching Guild War ranking')

    // Last successful season, else the global max, so cold-start guilds skip the wide probe.
    let dbGWSeasonCache: number | null = null
    try {
      const { data: seasonRow } = await supabase
        .from('guild_config')
        .select('last_successful_gw_season')
        .eq('guild_code', guildCode)
        .single()
      dbGWSeasonCache =
        (seasonRow as { last_successful_gw_season?: number } | null)
          ?.last_successful_gw_season ?? null

      if (dbGWSeasonCache === null) {
        const { data: globalRow } = await supabase
          .from('guild_config')
          .select('last_successful_gw_season')
          .not('last_successful_gw_season', 'is', null)
          .order('last_successful_gw_season', { ascending: false })
          .limit(1)
          .single()
        dbGWSeasonCache =
          (globalRow as { last_successful_gw_season?: number } | null)
            ?.last_successful_gw_season ?? null
        if (dbGWSeasonCache) {
          logger.info(
            { guildCode },
            `No local GW season cache — using global max: ${dbGWSeasonCache}`
          )
        }
      }
    } catch {
      /* non-critical, fall through to wide probe */
    }

    // Probe newest-first from the calendar. Historical leaderboards also answer,
    // so leading with the cached season would pin a guild to a stale season.
    const nowSeason = currentGwSeason()
    const seasonsToTry = buildGwSeasonsToTry(nowSeason, dbGWSeasonCache)

    if (dbGWSeasonCache) {
      logger.info(
        { guildCode },
        `Using DB-cached GW season: ${dbGWSeasonCache}`
      )
    }

    let authFailedInLoop = false
    let sessionRefreshedInLoop = false
    for (const season of seasonsToTry) {
      let result = await fetchRanking('GUILD_WAR', sessionId, season)

      if (
        shouldRefreshSession(result, clientSecret) &&
        !sessionRefreshedInLoop
      ) {
        logger.info(
          { guildCode },
          `Refreshing session for GW ranking fetch (season ${season})`
        )
        const newSessionId = await refreshSessionId(
          guildCode,
          userId,
          clientSecret
        )
        if (newSessionId) {
          await updateSessionIdInDatabase(supabase, guildCode, newSessionId)
          sessionId = newSessionId
          sessionRefreshedInLoop = true
          result = await fetchRanking('GUILD_WAR', newSessionId, season)
        } else {
          // Credentials are bad; stop probing to avoid N×2 amplification.
          logger.error(
            { guildCode },
            'GW season probe: session refresh failed, aborting loop'
          )
          authFailedInLoop = true
          break
        }
      } else if (
        shouldRefreshSession(result, clientSecret) &&
        sessionRefreshedInLoop
      ) {
        logger.error(
          { guildCode },
          'GW season probe: still getting auth errors after refresh, aborting'
        )
        authFailedInLoop = true
        break
      }

      if (result.success) {
        const rankingData = extractRanking(result.data, 'GUILD_WAR')
        if (rankingData) {
          rankings.guildWar = rankingData.rank
          successfulGWSeason = season
          logger.info(
            { guildCode },
            `Guild War ranking: ${rankings.guildWar} (Season ${rankingData.season || season})`
          )
          break
        }
      }
    }
    if (authFailedInLoop) {
      logger.warn({ guildCode }, 'GW ranking skipped — Loki auth failed')
    }

    if (successfulGWSeason === null) {
      logger.warn(
        { guildCode },
        'Guild War ranking not found across all attempted seasons'
      )
    }
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `Failed to fetch GW ranking: ${getErrorMessage(error)}`
    )
  }

  // Rankings above MAX_VALID_GUILD_RANKING are day-off garbage from the between-season gap.
  if (
    rankings.guildRaid !== null ||
    rankings.guildWar !== null ||
    successfulGWSeason !== null
  ) {
    try {
      const updateData: Partial<
        Pick<GuildConfigRow, 'GR_Ranking' | 'GW_Ranking'>
      > & { last_successful_gw_season?: number } = {}

      if (isPersistableGuildRanking(rankings.guildRaid)) {
        updateData.GR_Ranking = rankings.guildRaid
      } else if (
        rankings.guildRaid !== null &&
        rankings.guildRaid > MAX_VALID_GUILD_RANKING
      ) {
        logger.warn(
          {
            guildCode,
            value: rankings.guildRaid,
            max: MAX_VALID_GUILD_RANKING
          },
          'Skipping GR ranking update: value exceeds max (likely day-off garbage)'
        )
      }

      if (isPersistableGuildRanking(rankings.guildWar)) {
        updateData.GW_Ranking = rankings.guildWar
      } else if (
        rankings.guildWar !== null &&
        rankings.guildWar > MAX_VALID_GUILD_RANKING
      ) {
        logger.warn(
          { guildCode, value: rankings.guildWar, max: MAX_VALID_GUILD_RANKING },
          'Skipping GW ranking update: value exceeds max (likely day-off garbage)'
        )
      }

      if (successfulGWSeason !== null) {
        updateData.last_successful_gw_season = successfulGWSeason
      }

      if (Object.keys(updateData).length > 0) {
        const { error } = await supabase
          .from('guild_config')
          .update({
            ...updateData,
            updated_at: new Date().toISOString()
          })
          .eq('guild_code', guildCode)

        if (error) {
          logger.error(
            { guildCode },
            `Failed to update rankings in database: ${error.message}`
          )
        } else {
          logger.info(
            { guildCode },
            `Updated rankings in database - GR: ${rankings.guildRaid}, GW: ${rankings.guildWar}`
          )
        }
      }
    } catch (error: unknown) {
      logger.error(
        { guildCode },
        `Exception updating rankings: ${getErrorMessage(error)}`
      )
    }
  }

  return rankings
}

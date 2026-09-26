import { timeoutFetch } from '../timeout-utils.ts'
import { currentGwSeason } from '../gw-season.ts'
import { PUBLIC_LOKI_INSTALL_ID } from '../loki-public-device.ts'
import {
  buildGwSeasonsToTry,
  isPersistableGuildRanking,
  MAX_VALID_GUILD_RANKING
} from '../gw-ranking-policy.ts'

export interface GuildRankings {
  guildRaid: number | null
  guildWar: number | null
}

export interface RankingsApiDeps {
  logger: {
    info: (ctx: string, msg: string) => void
    warn: (ctx: string, msg: string) => void
    error: (ctx: string, msg: string, err?: unknown) => void
  }
  refreshSessionId: (
    guildCode: string,
    userId: string,
    clientSecret: string,
    timeouts: any
  ) => Promise<string | null>
  updateSessionIdInDatabase: (
    supabase: any,
    guildCode: string,
    newSessionId: string
  ) => Promise<boolean>
}

export interface RankingsApiConfig {
  lokiUrl: string
  guildConfigTable: string
}

// No in-memory season cache (edge functions are ephemeral); guild_config persists it.

function shouldRefreshSession(
  result: { success: boolean; status?: number; error?: string },
  clientSecret: string
): boolean {
  if (!clientSecret || result.success) return false
  const hasInvalidSessionError =
    result.status === 500 &&
    typeof result.error === 'string' &&
    (result.error.includes('invalid_session') ||
      result.error.includes('Incorrect session key'))
  // 401 is an expired session (refreshable); 403 is a permission denial (not).
  return result.status === 401 || hasInvalidSessionError
}

export async function fetchGuildRankings(
  deps: RankingsApiDeps,
  config: RankingsApiConfig,
  params: {
    guildCode: string
    guildId: string
    userId: string
    sessionId: string
    clientSecret: string
    supabase: any
    timeouts: any
  }
): Promise<GuildRankings> {
  const { guildCode, guildId, userId, clientSecret, supabase, timeouts } =
    params
  let { sessionId } = params
  const { logger, refreshSessionId, updateSessionIdInDatabase } = deps

  const rankings: GuildRankings = { guildRaid: null, guildWar: null }
  let successfulGWSeason: number | null = null

  async function fetchRanking(
    type: 'GUILD_RAID' | 'GUILD_WAR',
    currentSessionId: string,
    gwSeason: number | null = null
  ): Promise<{
    success: boolean
    status?: number
    error?: string
    data?: any
  }> {
    const url = `${config.lokiUrl}/player/player2/userId/${userId}/sessionId/${currentSessionId}`

    const payload =
      type === 'GUILD_RAID'
        ? {
            playerEvent: {
              playerEventType: 'GET_GUILD_SEASON_LEADERBOARD',
              playerEventData: { guildId },
              universeVersion: 'universe_not_needed',
              gameConfigVersion: '9517a7dd237edad05a86e948e469c631',
              createdOn: Date.now().toString(),
              multiConfigVersion: ''
            },
            builtInMultiConfigVersion: '',
            installId: PUBLIC_LOKI_INSTALL_ID
          }
        : {
            playerEvent: {
              playerEventType: 'GET_GUILD_WAR_LEADERBOARD',
              playerEventData: { guildId, season: gwSeason },
              universeVersion: 'universe_not_needed',
              gameConfigVersion: '9517a7dd237edad05a86e948e469c631',
              createdOn: Date.now().toString(),
              multiConfigVersion: ''
            },
            builtInMultiConfigVersion: '',
            installId: PUBLIC_LOKI_INSTALL_ID
          }

    try {
      const response = await timeoutFetch(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: '*/*',
            'User-Agent': 'UnityPlayer/2022.3.40f1',
            'X-Unity-Version': '2022.3.40f1'
          },
          body: JSON.stringify(payload)
        },
        'api_request',
        timeouts
      )

      if (!response.ok) {
        return { success: false, status: response.status }
      }

      const data = await response.json()
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  function extractRanking(
    data: any,
    type: 'GUILD_RAID' | 'GUILD_WAR' = 'GUILD_WAR'
  ): { rank: number; season: number } | null {
    try {
      const leaderboard = data?.eventResult?.eventResponseData?.leaderboard
      if (!leaderboard) return null

      // GUILD_RAID: top[] order is authoritative; guildPosition returns ties and day-off garbage.
      if (type === 'GUILD_RAID') {
        const top = leaderboard.top || []
        const guildIndex = top.findIndex((g: any) => g.guildTag === guildCode)
        if (guildIndex >= 0) {
          return { rank: guildIndex + 1, season: leaderboard.season }
        }
      }

      if (typeof leaderboard.guildPosition === 'number') {
        return {
          rank: leaderboard.guildPosition + 1,
          season: leaderboard.season
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Writes only the calling guild's GR_Ranking: writing others' ranks through
   * the RLS-bypassing client lets one stale leaderboard corrupt every guild.
   */
  async function updateOwnRaidRanking(data: any): Promise<void> {
    try {
      const top = data?.eventResult?.eventResponseData?.leaderboard?.top || []
      if (top.length === 0) return

      const guildIndex = top.findIndex((g: any) => g.guildTag === guildCode)
      if (guildIndex < 0) return

      const rank = guildIndex + 1
      if (rank > MAX_VALID_GUILD_RANKING) return

      await supabase
        .from(config.guildConfigTable)
        .update({ GR_Ranking: rank, updated_at: new Date().toISOString() })
        .eq('guild_code', guildCode)

      logger.info(
        guildCode,
        `Updated own GR_Ranking to ${rank} from leaderboard`
      )
    } catch (error: any) {
      logger.warn(
        guildCode,
        `Failed to update own raid ranking: ${error.message}`
      )
    }
  }

  try {
    logger.info(guildCode, 'Fetching Guild Raid ranking')
    let result = await fetchRanking('GUILD_RAID', sessionId)

    if (shouldRefreshSession(result, clientSecret)) {
      const newSessionId = await refreshSessionId(
        guildCode,
        userId,
        clientSecret,
        timeouts
      )
      if (newSessionId) {
        await updateSessionIdInDatabase(supabase, guildCode, newSessionId)
        sessionId = newSessionId
        result = await fetchRanking('GUILD_RAID', newSessionId)
      } else {
        logger.error(
          guildCode,
          'GR ranking: session refresh failed — credentials likely invalid'
        )
        return rankings
      }
    }

    if (result.success) {
      const rankingData = extractRanking(result.data, 'GUILD_RAID')
      if (rankingData) {
        rankings.guildRaid = rankingData.rank
        logger.info(guildCode, `Guild Raid ranking: ${rankings.guildRaid}`)
      }
      await updateOwnRaidRanking(result.data)
    }
  } catch (error: any) {
    logger.error(guildCode, `Failed to fetch GR ranking: ${error.message}`)
  }

  try {
    logger.info(guildCode, 'Fetching Guild War ranking')

    let dbGWSeasonCache: number | null = null
    try {
      const { data: seasonRow } = await supabase
        .from(config.guildConfigTable)
        .select('last_successful_gw_season')
        .eq('guild_code', guildCode)
        .single()
      dbGWSeasonCache = seasonRow?.last_successful_gw_season ?? null
    } catch {
      /* non-critical, fall through to wide probe */
    }

    // Probe newest-first from the calendar: historical leaderboards answer too, so leading with the
    // cached season would pin each guild to it. The cache only covers calendar drift.
    const nowSeason = currentGwSeason()
    const seasonsToTry = buildGwSeasonsToTry(nowSeason, dbGWSeasonCache)

    if (dbGWSeasonCache) {
      logger.info(guildCode, `Using DB-cached GW season: ${dbGWSeasonCache}`)
    }

    let sessionRefreshedInLoop = false
    for (const season of seasonsToTry) {
      let result = await fetchRanking('GUILD_WAR', sessionId, season)

      if (
        shouldRefreshSession(result, clientSecret) &&
        !sessionRefreshedInLoop
      ) {
        // At most one CONNECT refresh per loop.
        const newSessionId = await refreshSessionId(
          guildCode,
          userId,
          clientSecret,
          timeouts
        )
        if (newSessionId) {
          await updateSessionIdInDatabase(supabase, guildCode, newSessionId)
          sessionId = newSessionId
          sessionRefreshedInLoop = true
          result = await fetchRanking('GUILD_WAR', newSessionId, season)
        } else {
          logger.error(
            guildCode,
            'GW season probe: session refresh failed, aborting loop'
          )
          break
        }
      } else if (
        shouldRefreshSession(result, clientSecret) &&
        sessionRefreshedInLoop
      ) {
        logger.error(
          guildCode,
          'GW season probe: still getting auth errors after refresh, aborting'
        )
        break
      }

      if (result.success) {
        const rankingData = extractRanking(result.data, 'GUILD_WAR')
        if (rankingData) {
          rankings.guildWar = rankingData.rank
          successfulGWSeason = season
          logger.info(
            guildCode,
            `Guild War ranking: ${rankings.guildWar} (Season ${season})`
          )
          break
        }
      }
    }

    if (successfulGWSeason === null) {
      logger.warn(
        guildCode,
        'Guild War ranking not found across all attempted seasons'
      )
    }
  } catch (error: any) {
    logger.error(guildCode, `Failed to fetch GW ranking: ${error.message}`)
  }

  if (
    rankings.guildRaid !== null ||
    rankings.guildWar !== null ||
    successfulGWSeason !== null
  ) {
    try {
      const updateData: Record<string, number | string> = {}

      if (isPersistableGuildRanking(rankings.guildRaid)) {
        updateData.GR_Ranking = rankings.guildRaid
      } else if (
        rankings.guildRaid !== null &&
        rankings.guildRaid > MAX_VALID_GUILD_RANKING
      ) {
        logger.warn(
          guildCode,
          `Skipping GR ranking update - value ${rankings.guildRaid} exceeds ${MAX_VALID_GUILD_RANKING} (likely day-off garbage)`
        )
      }

      if (isPersistableGuildRanking(rankings.guildWar)) {
        updateData.GW_Ranking = rankings.guildWar
      } else if (
        rankings.guildWar !== null &&
        rankings.guildWar > MAX_VALID_GUILD_RANKING
      ) {
        logger.warn(
          guildCode,
          `Skipping GW ranking update - value ${rankings.guildWar} exceeds ${MAX_VALID_GUILD_RANKING} (likely day-off garbage)`
        )
      }

      if (successfulGWSeason !== null) {
        updateData.last_successful_gw_season = successfulGWSeason
      }

      if (Object.keys(updateData).length > 0) {
        await supabase
          .from(config.guildConfigTable)
          .update({ ...updateData, updated_at: new Date().toISOString() })
          .eq('guild_code', guildCode)

        logger.info(
          guildCode,
          `Updated rankings: GR=${rankings.guildRaid}, GW=${rankings.guildWar}`
        )
      }
    } catch (error: any) {
      logger.error(guildCode, `Failed to update rankings: ${error.message}`)
    }
  }

  return rankings
}

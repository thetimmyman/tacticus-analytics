import { normalizeTacticusGuildRole } from '@tacticus/app-core/role-utils'
import { PUBLIC_LOKI_INSTALL_ID } from '@/app/lib/loki/public-device'
import type { LokiMember } from './transformers'
import type { PlayerRole, TypedSupabaseClient } from '@tacticus/app-core/types'
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

export type LokiFetchResult = {
  members: LokiMember[]
  authFailed: boolean
}

type LokiMemberRecord = {
  userId?: string | null
  playerId?: string | null
  id?: string | null
  displayName?: string | null
  name?: string | null
  playerName?: string | null
  role?: string | null
  guildRole?: string | null
  memberRole?: string | null
  hasDuplicateName?: boolean
  originalDisplayName?: string | null
  avatarUnitId?: string | null
  avatarId?: string | null
  level?: number | string | null
  claimedPowerLevel?: number | string | null
  playerLevel?: number | string | null
  power?: number | string | null
  powerLevel?: number | string | null
  guildPower?: number | string | null
}

export async function fetchGuildMembersViaLoki(
  guildCode: string,
  guildId: string,
  userId: string,
  sessionId: string,
  clientSecret: string,
  supabase: StrictSupabaseClient
): Promise<LokiFetchResult> {
  sessionId = await validateAndRefreshSession(
    guildCode,
    userId,
    sessionId,
    clientSecret,
    supabase
  )

  if (!sessionId) {
    logger.warn(
      { guildCode },
      'No valid session after validation — Loki credentials likely invalid'
    )
    return { members: [], authFailed: true }
  }

  const payload = {
    playerEvent: {
      playerEventType: 'VIEW_GUILD_2',
      playerEventData: {
        guildId: guildId
      },
      universeVersion: 'universe_not_needed',
      gameConfigVersion: '75da56c8362630f0ff1838e76b4c6e54',
      createdOn: Date.now().toString(),
      multiConfigVersion: ''
    },
    builtInMultiConfigVersion: '',
    installId: PUBLIC_LOKI_INSTALL_ID
  }

  async function attemptLokiCall(
    currentSessionId: string
  ): Promise<LokiApiResult<Record<string, unknown>>> {
    const currentUrl = `${CONFIG.api.lokiUrl}/player/player2/userId/${userId}/sessionId/${currentSessionId}`

    try {
      const response = await fetchWithCircuitBreaker(
        currentUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify(payload)
        },
        2,
        CONFIG.api.lokiTimeout
      )

      logger.info({ guildCode }, `LOKI API Response Status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(
          { guildCode },
          `LOKI API failed: ${response.status} - ${errorText}`
        )
        return {
          success: false,
          status: response.status,
          error: errorText
        }
      }

      const data = await response.json()
      return {
        success: true,
        data
      }
    } catch (error: unknown) {
      return {
        success: false,
        status: 500,
        error: getErrorMessage(error)
      }
    }
  }

  try {
    logger.info({ guildCode, guildId }, 'Calling LOKI API for guild')

    let result = await attemptLokiCall(sessionId)

    if (shouldRefreshSession(result, clientSecret)) {
      logger.warn(
        { guildCode },
        `Session appears expired (${result.status}), attempting refresh...`
      )
      const newSessionId = await refreshSessionId(
        guildCode,
        userId,
        clientSecret
      )

      if (newSessionId) {
        await updateSessionIdInDatabase(supabase, guildCode, newSessionId)
        logger.info({ guildCode }, 'Retrying LOKI API with fresh sessionId')
        result = await attemptLokiCall(newSessionId)
      } else {
        // CONNECT failed: credentials are likely dead; no retry, to avoid amplification.
        logger.error(
          { guildCode },
          'Session refresh failed — credentials likely invalid, skipping retry'
        )
        return { members: [], authFailed: true }
      }
    }

    if (!result.success) {
      logger.error(
        { guildCode },
        `LOKI API failed after all retry attempts: ${result.error || 'Unknown error'}`
      )
      return { members: [], authFailed: false }
    }

    const data = result.data as Record<string, unknown> | undefined
    logger.info(
      { guildCode },
      `LOKI API Success! Response keys: ${JSON.stringify(Object.keys(data || {}))}`
    )

    const guildResponse = (
      data as {
        eventResult?: { eventResponseData?: { guild?: { members?: unknown } } }
      }
    )?.eventResult?.eventResponseData?.guild?.members

    const rawMembers = Array.isArray(guildResponse)
      ? (guildResponse as LokiMemberRecord[])
      : []

    if (rawMembers.length === 0) {
      logger.warn(
        { guildCode },
        'No member data found in LOKI response structure'
      )
    } else {
      logger.info(
        { guildCode, memberCount: rawMembers.length },
        'Found guild members'
      )
    }

    const toNonEmptyString = (value: unknown): string | null =>
      typeof value === 'string' && value.trim().length > 0 ? value : null

    const members: LokiMember[] = []
    for (const member of rawMembers) {
      const playerId =
        toNonEmptyString(member.userId) ||
        toNonEmptyString(member.playerId) ||
        toNonEmptyString(member.id)
      const displayName =
        toNonEmptyString(member.displayName) ||
        toNonEmptyString(member.name) ||
        toNonEmptyString(member.playerName)

      const rawRole =
        toNonEmptyString(member.role) ||
        toNonEmptyString(member.guildRole) ||
        toNonEmptyString(member.memberRole)
      const role: PlayerRole | string = normalizeTacticusGuildRole(rawRole)

      if (playerId && displayName) {
        // VIEW_GUILD_2 omits account power; player-profile paths set player_power.
        const avatarUnitId =
          toNonEmptyString(member.avatarUnitId) ||
          toNonEmptyString(member.avatarId) ||
          null
        const rawLevel =
          member.level ?? member.claimedPowerLevel ?? member.playerLevel
        const playerLevel =
          typeof rawLevel === 'number'
            ? rawLevel
            : typeof rawLevel === 'string'
              ? Number(rawLevel)
              : null
        const rawPower = member.power ?? member.powerLevel ?? member.guildPower
        const playerPower =
          typeof rawPower === 'number'
            ? rawPower
            : typeof rawPower === 'string'
              ? Number(rawPower)
              : null

        members.push({
          userId: playerId,
          displayName,
          role,
          hasDuplicateName: member.hasDuplicateName,
          originalDisplayName: member.originalDisplayName ?? null,
          avatarUnitId,
          playerLevel:
            playerLevel !== null && Number.isFinite(playerLevel)
              ? playerLevel
              : null,
          playerPower:
            playerPower !== null && Number.isFinite(playerPower)
              ? playerPower
              : null
        })
      }
    }

    return { members, authFailed: false }
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `LOKI members fetch exception: ${getErrorMessage(error)}`
    )
    return { members: [], authFailed: false }
  }
}

// No in-memory cache: season persists in guild_config.last_successful_gw_season.

export async function detectCurrentGWSeasonFromGuildData(
  guildCode: string,
  apiKey: string
): Promise<number | null> {
  try {
    const response = await fetchWithCircuitBreaker(
      `${CONFIG.api.baseUrl}/guild`,
      {
        headers: {
          'X-API-KEY': apiKey,
          Accept: 'application/json'
        }
      },
      2,
      10000
    )

    if (response.ok) {
      const data = await response.json()

      const possibleSeasonPaths = [
        data.currentGuildWarSeason,
        data.guildWarSeason,
        data.guild?.currentGuildWarSeason,
        data.guild?.guildWar?.season,
        data.guild?.guildWar?.currentSeason,
        data.seasons?.guildWar,
        data.activeEvents?.guildWar?.season
      ]

      for (const seasonPath of possibleSeasonPaths) {
        if (seasonPath && typeof seasonPath === 'number') {
          logger.info(
            { guildCode },
            `Found current GW season from guild data: ${seasonPath}`
          )
          return seasonPath
        }
      }
    }
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `Exception detecting GW season from guild data: ${getErrorMessage(error)}`
    )
  }

  return null
}

import { timeoutFetch } from '../timeout-utils.ts'
import { pickString, getErrorMessage, toNumberValue } from './helpers.ts'
import { PUBLIC_LOKI_INSTALL_ID } from '../loki-public-device.ts'

export interface LokiMember {
  userId: string
  displayName: string
  role: string
  originalDisplayName?: string
  hasDuplicateName?: boolean
  avatarUnitId?: string
  claimedPowerLevel?: number
  playerPower?: number
}

export interface LokiApiClientDeps {
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

export interface LokiApiConfig {
  baseUrl: string
}

function parseGuildMembers(
  data: Record<string, unknown> | null,
  guildCode: string,
  logger: LokiApiClientDeps['logger']
): LokiMember[] {
  logger.info(
    guildCode,
    `LOKI API Success! Response keys: ${JSON.stringify(Object.keys(data || {}))}`
  )

  const rawMembers = (() => {
    const membersValue =
      data?.eventResult && typeof data.eventResult === 'object'
        ? (data.eventResult as Record<string, unknown>).eventResponseData
        : undefined
    const guildSection =
      membersValue && typeof membersValue === 'object'
        ? (membersValue as Record<string, unknown>).guild
        : undefined
    const members =
      guildSection && typeof guildSection === 'object'
        ? (guildSection as Record<string, unknown>).members
        : undefined
    return Array.isArray(members)
      ? (members as Array<Record<string, unknown>>)
      : []
  })()

  if (rawMembers.length === 0) {
    logger.warn(guildCode, `No member data found in LOKI response structure`)
  }

  const members: LokiMember[] = []
  const membersWithoutDisplayName: string[] = []

  for (const member of rawMembers) {
    const playerId = pickString(member.userId, member.playerId, member.id)
    const displayName = pickString(
      member.displayName,
      member.name,
      member.playerName
    )

    // Must mirror normalizeTacticusGuildRole in packages/app-core (this Deno bundle cannot import it).
    let role: string = 'member'
    const rawRole = pickString(member.role, member.guildRole, member.memberRole)
    if (rawRole) {
      const roleUpper = rawRole.toUpperCase()
      if (roleUpper === 'LEADER' || roleUpper === 'GUILD_LEADER') {
        role = 'leader'
      } else if (roleUpper === 'CO_LEADER' || roleUpper === 'COLEADER') {
        role = 'leader'
      } else if (roleUpper === 'OFFICER' || roleUpper === 'GUILD_OFFICER') {
        role = 'officer'
      }
    }

    if (playerId && displayName) {
      const avatarRoot =
        typeof member.avatar === 'object' && member.avatar !== null
          ? (member.avatar as Record<string, unknown>)
          : null
      const profileRoot =
        typeof member.profile === 'object' && member.profile !== null
          ? (member.profile as Record<string, unknown>)
          : null
      const profileAvatarValue = profileRoot?.['avatar']
      const profileAvatarRoot =
        typeof profileAvatarValue === 'object' && profileAvatarValue !== null
          ? (profileAvatarValue as Record<string, unknown>)
          : null

      const avatarUnitId = pickString(
        member.avatarUnitId,
        member.avatarId,
        member.avatar_unit_id,
        member.avatar,
        avatarRoot?.avatarUnitId,
        avatarRoot?.avatarId,
        avatarRoot?.id,
        profileAvatarRoot?.avatarUnitId,
        profileAvatarRoot?.avatarId,
        profileAvatarRoot?.id
      )
      const playerLevel =
        typeof member.level === 'number'
          ? member.level
          : typeof member.claimedPowerLevel === 'number'
            ? member.claimedPowerLevel
            : typeof member.playerLevel === 'number'
              ? member.playerLevel
              : undefined
      const playerPower =
        toNumberValue(member.power) ??
        toNumberValue(member.powerLevel) ??
        toNumberValue(member.guildPower)
      if (!avatarUnitId && rawMembers.indexOf(member) === 0) {
        logger.info(
          guildCode,
          `First member raw keys: ${JSON.stringify(Object.keys(member))}`
        )
      }
      members.push({
        userId: playerId,
        displayName,
        role,
        ...(avatarUnitId ? { avatarUnitId } : {}),
        ...(playerLevel ? { claimedPowerLevel: playerLevel } : {}),
        ...(playerPower !== null ? { playerPower } : {})
      })
    } else if (playerId && !displayName) {
      membersWithoutDisplayName.push(playerId)
      logger.warn(
        guildCode,
        `LOKI returned member ${playerId} WITHOUT displayName - will need DB fallback`
      )
    }
  }

  if (membersWithoutDisplayName.length > 0) {
    logger.warn(
      guildCode,
      `${membersWithoutDisplayName.length} members missing displayName from LOKI: ${membersWithoutDisplayName.join(', ')}`
    )
  }

  return members
}

export async function fetchGuildMembersViaLoki(
  deps: LokiApiClientDeps,
  config: LokiApiConfig,
  params: {
    guildCode: string
    guildId: string
    userId: string
    sessionId: string
    clientSecret: string
    supabase: any
    timeouts: any
    initialSync?: boolean
    recentActivityIds?: Set<string>
  }
): Promise<LokiMember[]> {
  const { guildCode, guildId, userId, clientSecret, supabase, timeouts } =
    params
  let { sessionId } = params
  const isInitialSync = params.initialSync === true

  const payload = {
    playerEvent: {
      playerEventType: 'VIEW_GUILD_2',
      playerEventData: { guildId },
      universeVersion: 'universe_not_needed',
      gameConfigVersion: '4e661fec785ba22d843a34a23cb4d229',
      createdOn: Date.now().toString(),
      multiConfigVersion: ''
    },
    builtInMultiConfigVersion: '',
    installId: PUBLIC_LOKI_INSTALL_ID
  }

  const isInvalidSessionError = (result: {
    success: boolean
    status?: number
    error?: string
  }): boolean => {
    return (
      !result.success &&
      result.status === 500 &&
      !!result.error &&
      (result.error.includes('invalid_session') ||
        result.error.includes('Incorrect session key'))
    )
  }

  const shouldRefreshSession = (result: {
    success: boolean
    status?: number
    error?: string
  }): boolean => {
    if (!clientSecret) return false
    // 401 = expired session (refreshable); 403 = permission denied (not).
    return (
      !result.success &&
      (result.status === 401 || isInvalidSessionError(result))
    )
  }

  async function attemptLokiCall(currentSessionId: string) {
    const callUrl = `${config.baseUrl}/player/player2/userId/${userId}/sessionId/${currentSessionId}`
    try {
      const response = await timeoutFetch(
        callUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify(payload)
        },
        'api_request',
        timeouts
      )

      deps.logger.info(
        guildCode,
        `LOKI API Response Status: ${response.status}`
      )

      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          status: response.status,
          error: errorText
        }
      }

      const data = await response.json()
      return { success: true, data }
    } catch (error) {
      return {
        success: false,
        status: 500,
        error: getErrorMessage(error)
      }
    }
  }

  try {
    // Try the existing session first; refresh only on an auth error.
    deps.logger.info(
      guildCode,
      `Calling LOKI API for guild ${guildId} with existing session`
    )
    let result = await attemptLokiCall(sessionId)
    const initialInvalidSession = isInitialSync && isInvalidSessionError(result)

    if (!result.success) {
      if (initialInvalidSession) {
        // Initial sync uses a shared default session; invalid_session is expected until refresh succeeds.
        deps.logger.info(
          guildCode,
          `LOKI session invalid on initial sync; refresh_expected=true status=${result.status}`
        )
      } else {
        deps.logger.error(
          guildCode,
          `LOKI API failed: ${result.status} - ${result.error || 'Unknown error'}`
        )
      }
    }

    if (shouldRefreshSession(result) && clientSecret) {
      if (initialInvalidSession) {
        deps.logger.info(
          guildCode,
          `Session appears expired (${result.status}), attempting refresh... refresh_expected=true`
        )
      } else {
        deps.logger.warn(
          guildCode,
          `Session appears expired (${result.status}), attempting refresh...`
        )
      }
      const newSessionId = await deps.refreshSessionId(
        guildCode,
        userId,
        clientSecret,
        timeouts
      )
      if (newSessionId) {
        sessionId = newSessionId
        await deps.updateSessionIdInDatabase(supabase, guildCode, newSessionId)
        deps.logger.info(
          guildCode,
          `Session refreshed, retrying LOKI API with fresh sessionId`
        )
        result = await attemptLokiCall(newSessionId)
      } else {
        deps.logger.error(
          guildCode,
          `Session refresh failed — credentials likely invalid, skipping retry`
        )
        return []
      }
    }

    if (!result.success) {
      deps.logger.error(
        guildCode,
        `LOKI API failed after all retry attempts: ${result.error || 'Unknown error'}`
      )
      return []
    }

    const members = parseGuildMembers(
      result.data as Record<string, unknown> | null,
      guildCode,
      deps.logger
    )

    // A reused session can return a stale roster missing recent joiners: if active players are absent,
    // force one fresh CONNECT and keep the larger roster (one retry, to avoid a CONNECT herd).
    const recentActivityIds = params.recentActivityIds
    if (
      recentActivityIds &&
      recentActivityIds.size > 0 &&
      !isInitialSync &&
      clientSecret
    ) {
      const present = new Set(members.map((m) => m.userId))
      const missingActive = Array.from(recentActivityIds).filter(
        (id) => !present.has(id)
      )
      if (missingActive.length > 0) {
        deps.logger.warn(
          guildCode,
          `Roster missing ${missingActive.length} active member(s) [${missingActive.slice(0, 10).join(', ')}]; forcing fresh-session retry`
        )
        const retrySessionId = await deps.refreshSessionId(
          guildCode,
          userId,
          clientSecret,
          timeouts
        )
        if (retrySessionId) {
          await deps.updateSessionIdInDatabase(
            supabase,
            guildCode,
            retrySessionId
          )
          const retryResult = await attemptLokiCall(retrySessionId)
          if (retryResult.success) {
            const retryMembers = parseGuildMembers(
              retryResult.data as Record<string, unknown> | null,
              guildCode,
              deps.logger
            )
            if (retryMembers.length > members.length) {
              deps.logger.info(
                guildCode,
                `Fresh-session retry returned ${retryMembers.length} members (was ${members.length})`
              )
              return retryMembers
            }
          }
        }
      }
    }

    return members
  } catch (error) {
    deps.logger.error(
      guildCode,
      `LOKI members fetch exception: ${getErrorMessage(error)}`,
      error
    )
    return []
  }
}

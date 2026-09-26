import { resolveLokiBuildString } from '@/app/lib/loki/build-string'
import {
  buildLokiConnectPayload,
  findLokiSessionId
} from '@/app/lib/loki/session-refresh'
import type { GuildRaidApiResponse } from './transformers'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  CONFIG,
  fetchWithCircuitBreaker,
  getErrorMessage,
  logger
} from './api-client'

type StrictSupabaseClient = TypedSupabaseClient

export type LokiApiResult<T = unknown> = {
  success: boolean
  status?: number
  error?: string
  data?: T
}

export async function validateAndRefreshSession(
  guildCode: string,
  userId: string,
  sessionId: string | null,
  clientSecret: string,
  supabase: StrictSupabaseClient
): Promise<string> {
  if (!sessionId || sessionId.length < 10) {
    logger.warn(
      { guildCode },
      'Session ID appears invalid or missing, refreshing...'
    )
    if (clientSecret) {
      const newSessionId = await refreshSessionId(
        guildCode,
        userId,
        clientSecret
      )
      if (newSessionId) {
        await updateSessionIdInDatabase(supabase, guildCode, newSessionId)
        return newSessionId
      }
    }
    return sessionId || ''
  }
  return sessionId
}

export async function refreshSessionId(
  guildCode: string,
  userId: string,
  clientSecret: string
): Promise<string | null> {
  try {
    const url = `${CONFIG.api.lokiUrl}/player/player2/userId/${userId}`
    const buildString = await resolveLokiBuildString()
    const payload = buildLokiConnectPayload(userId, clientSecret, buildString)

    logger.info({ guildCode }, 'Refreshing Loki session')

    const response = await fetchWithCircuitBreaker(
      url,
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

    if (!response.ok) {
      logger.error(
        { guildCode },
        `SessionId refresh failed: ${response.status}`
      )
      return null
    }

    const data: GuildRaidApiResponse = await response.json()

    const sessionId = findLokiSessionId(data)

    if (sessionId) {
      logger.info({ guildCode }, 'Successfully refreshed sessionId')
      return sessionId
    } else {
      logger.warn(
        { guildCode },
        'SessionId not found anywhere in refresh response'
      )
      return null
    }
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `Exception refreshing sessionId: ${getErrorMessage(error)}`
    )
    return null
  }
}

export async function updateSessionIdInDatabase(
  supabase: StrictSupabaseClient,
  guildCode: string,
  newSessionId: string
) {
  try {
    const { error } = await supabase
      .from('guild_config')
      .update({
        session_id: newSessionId,
        updated_at: new Date().toISOString()
      })
      .eq('guild_code', guildCode)

    if (error) {
      logger.error(
        { guildCode },
        `Failed to update sessionId in database: ${error.message}`
      )
      return false
    }

    logger.info({ guildCode }, 'Updated sessionId in database')
    return true
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `Exception updating sessionId: ${getErrorMessage(error)}`
    )
    return false
  }
}

export function shouldRefreshSession(
  result: LokiApiResult,
  clientSecret: string
): boolean {
  if (!clientSecret || result.success) {
    return false
  }

  const hasInvalidSessionError =
    result.status === 500 &&
    typeof result.error === 'string' &&
    (result.error.includes('invalid_session') ||
      result.error.includes('Incorrect session key'))

  // 401 is an expired session; 403 is a permission denial and not refreshable.
  return result.status === 401 || hasInvalidSessionError
}

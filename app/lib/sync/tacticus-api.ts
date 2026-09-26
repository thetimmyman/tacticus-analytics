import { withRetry, TACTICUS_API_POLICY } from '@/app/lib/resilience'
import {
  CONFIG,
  fetchWithAbortTimeout,
  fetchWithCircuitBreaker,
  getErrorMessage,
  logger
} from './api-client'

export type TacticusMembersResult = {
  success: boolean
  memberIds: string[]
  error?: string
}

export async function fetchGuildMembersViaTacticus(
  apiKey: string,
  guildId: string,
  guildCode: string
): Promise<TacticusMembersResult> {
  const url = `${CONFIG.api.baseUrl}/guild/${guildId}/members`

  try {
    logger.info(
      { guildCode, guildId },
      'Fetching guild members from Tacticus API'
    )

    const response = await withRetry(
      async () => {
        const res = await fetchWithAbortTimeout(
          url,
          {
            method: 'GET',
            headers: {
              'X-API-KEY': apiKey,
              Accept: 'application/json'
            }
          },
          CONFIG.api.requestTimeout,
          'Tacticus guild members response'
        )
        if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`)
        return res
      },
      { ...TACTICUS_API_POLICY, maxAttempts: 2 }
    )

    if (!response.ok) {
      if (response.status === 404) {
        logger.info(
          { guildCode },
          'Tacticus members endpoint returned 404 - may not be available for this guild'
        )
        return { success: false, memberIds: [], error: 'Endpoint not found' }
      }
      return { success: false, memberIds: [], error: `HTTP ${response.status}` }
    }

    const data = (await response.json()) as Record<string, unknown>

    const possibleMemberArrays = [
      data.members,
      data.guildMembers,
      (data.body as Record<string, unknown> | undefined)?.members,
      (data.body as Record<string, unknown> | undefined)?.guildMembers,
      (data.guild as Record<string, unknown> | undefined)?.members
    ]

    type RawMember = {
      userId?: string
      playerId?: string
      id?: string
      odlPlayerId?: string
      odlId?: string
    }
    let rawMembers: RawMember[] = []

    for (const arr of possibleMemberArrays) {
      if (Array.isArray(arr) && arr.length > 0) {
        rawMembers = arr as RawMember[]
        break
      }
    }

    const memberIds: string[] = []
    for (const member of rawMembers) {
      const id =
        member.userId ||
        member.playerId ||
        member.id ||
        member.odlPlayerId ||
        member.odlId
      if (id && typeof id === 'string') {
        memberIds.push(id)
      }
    }

    if (memberIds.length > 0) {
      logger.info(
        { guildCode },
        `Tacticus API returned ${memberIds.length} guild members (authoritative for is_current)`
      )
    }

    return { success: memberIds.length > 0, memberIds }
  } catch (error) {
    logger.warn(
      { guildCode },
      `Tacticus members fetch failed: ${getErrorMessage(error)}`
    )
    return { success: false, memberIds: [], error: getErrorMessage(error) }
  }
}

export async function fetchGuildRaidData(
  apiKey: string,
  guildCode: string
): Promise<Response> {
  logger.info({ guildCode }, 'Fetching guild raid data...')
  return fetchWithCircuitBreaker(
    `${CONFIG.api.baseUrl}/guildRaid`,
    {
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json'
      }
    },
    3,
    CONFIG.api.requestTimeout
  )
}

import { timeoutFetch, retryWithTimeout } from '../timeout-utils.ts'
import { CircuitBreaker } from './circuit-breaker.ts'
import { getErrorMessage } from './helpers.ts'

export interface TacticusApiLogger {
  debug: (ctx: string, msg: string) => void
  warn: (ctx: string, msg: string) => void
  info?: (ctx: string, msg: string) => void
  error?: (ctx: string, msg: string) => void
}

export interface TacticusApiConfig {
  baseUrl: string
  maxRetries: number
}

export interface ApiCallResult<T> {
  success: boolean
  data: T | null
  error?: string
  isApiKeyError?: boolean
}

export interface TacticusMember {
  id: string
  odlId?: string
  odlPlayerId?: string
  odlName?: string
  playerId?: string
  userId?: string
  name?: string
  displayName?: string
  role?: string
  playerRole?: string
  guildRole?: string
}

export interface TacticusMembersResult {
  success: boolean
  memberIds: string[]
  members: TacticusMember[]
  error?: string
}

// Module scope so failures accumulate across calls in the isolate.
const tacticusApiCircuitBreaker = new CircuitBreaker(2, 30000)

export async function callTacticusApi<T = unknown>(
  endpoint: string,
  apiKey: string,
  guildCode: string,
  timeouts: any,
  config: TacticusApiConfig,
  logger: TacticusApiLogger
): Promise<ApiCallResult<T>> {
  const url = `${config.baseUrl}${endpoint}`
  const headers = {
    'X-API-KEY': apiKey,
    Accept: 'application/json'
  }

  const circuitBreaker = tacticusApiCircuitBreaker

  try {
    logger.debug(guildCode, `API call to ${endpoint}`)

    // Breaker outside retry: one logical call counts at most once, and an OPEN breaker fails fast.
    const data = await circuitBreaker.execute(() =>
      retryWithTimeout(
        async () => {
          const response = await timeoutFetch(
            url,
            { headers },
            'api_request',
            timeouts
          )

          if (!response.ok) {
            throw new Error(
              `API returned ${response.status}: ${response.statusText}`
            )
          }

          return (await response.json()) as T
        },
        'api_request',
        timeouts,
        config.maxRetries
      )
    )

    return { success: true, data }
  } catch (error) {
    const message = getErrorMessage(error)
    logger.warn(guildCode, `API call failed: ${message}`)

    if (message.includes('401') || message.includes('403')) {
      return {
        success: false,
        data: null,
        error: message,
        isApiKeyError: true
      }
    }

    return { success: false, data: null, error: message }
  }
}

export async function fetchGuildMembersViaTacticus(
  apiKey: string,
  guildId: string,
  guildCode: string,
  timeouts: any,
  config: TacticusApiConfig,
  logger: TacticusApiLogger
): Promise<TacticusMembersResult> {
  const endpoint = `/guild/${guildId}/members`
  const url = `${config.baseUrl}${endpoint}`
  const headers = {
    'X-API-KEY': apiKey,
    Accept: 'application/json'
  }

  const circuitBreaker = tacticusApiCircuitBreaker

  try {
    logger.debug(
      guildCode,
      `Fetching guild members from Tacticus API: ${endpoint}`
    )

    // Breaker outside retry (see callTacticusApi).
    const data = await circuitBreaker.execute(() =>
      retryWithTimeout(
        async () => {
          const response = await timeoutFetch(
            url,
            { headers },
            'api_request',
            timeouts
          )

          if (!response.ok) {
            if (response.status === 404) {
              logger.debug(
                guildCode,
                'Members endpoint returned 404 - endpoint may not exist for this guild'
              )
              return { members: [], guildMembers: [] }
            }
            throw new Error(
              `API returned ${response.status}: ${response.statusText}`
            )
          }

          return (await response.json()) as Record<string, unknown>
        },
        'api_request',
        timeouts,
        config.maxRetries
      )
    )

    const rawMembers: TacticusMember[] = []
    // The members payload shape varies across API/proxy variants.
    // deno-lint-ignore no-explicit-any
    const d = data as Record<string, any>
    const possibleMemberArrays = [
      d.members,
      d.guildMembers,
      d.body?.members,
      d.body?.guildMembers,
      d.guild?.members
    ]

    for (const arr of possibleMemberArrays) {
      if (Array.isArray(arr) && arr.length > 0) {
        for (const m of arr) {
          if (m && typeof m === 'object') {
            rawMembers.push(m as TacticusMember)
          }
        }
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
      logger.info?.(
        guildCode,
        `Tacticus API returned ${memberIds.length} guild members (authoritative for is_current)`
      )
    } else {
      logger.debug(
        guildCode,
        'Tacticus members endpoint returned no members or is not available'
      )
    }

    return {
      success: memberIds.length > 0,
      memberIds,
      members: rawMembers
    }
  } catch (error) {
    const message = getErrorMessage(error)
    logger.warn(guildCode, `Tacticus members fetch failed: ${message}`)

    return {
      success: false,
      memberIds: [],
      members: [],
      error: message
    }
  }
}

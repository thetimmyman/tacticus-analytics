/** Client for the official Tacticus API (based on Homina's implementation). */
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('tacticus-api')
import { TACTICUS_API } from '@tacticus/app-core/app-config'
import {
  CircuitBreaker,
  CircuitOpenError,
  DEFAULT_CIRCUIT_CONFIG,
  alertOnStateChange,
  withRetry,
  TACTICUS_API_POLICY
} from '@/app/lib/resilience'

const PLAYER_API_TIMEOUT = 20000
const PLAYER_API_MAX_RETRIES = 3
const PLAYER_API_RETRY_DELAY = 1000

// Per-call timeouts: a Promise.all over untimed fetches blocks on its slowest
// member and blows past the caller's soft timeout.
const VALIDATE_API_KEY_TIMEOUT_MS = 10_000
const GET_PLAYER_TIMEOUT_MS = 20_000
const GET_GUILD_TIMEOUT_MS = 15_000
const GET_GUILD_RAID_TIMEOUT_MS = 20_000

/**
 * Shared Tacticus circuit name. Never hard-code it: a stale name reads back as `null`,
 * which looks exactly like a healthy circuit.
 */
export const TACTICUS_CIRCUIT_NAME = 'tacticus-api'

const tacticusCircuit = new CircuitBreaker({
  name: TACTICUS_CIRCUIT_NAME,
  ...DEFAULT_CIRCUIT_CONFIG,
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  onStateChange: alertOnStateChange
})

interface ApiClientErrorDetails {
  message?: string
  stack?: string | string[]
}

type ErrorWrapper = { error?: { message?: unknown; stack?: unknown } }

const extractErrorDetails = (error: unknown): ApiClientErrorDetails | null => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ?? undefined
    }
  }

  if (error && typeof error === 'object') {
    const nestedError = (error as ErrorWrapper).error
    const message =
      nestedError && typeof nestedError.message === 'string'
        ? nestedError.message
        : undefined
    const stackValue = nestedError?.stack

    const stack =
      typeof stackValue === 'string' || Array.isArray(stackValue)
        ? stackValue
        : undefined

    if (message || stack) {
      return { message, stack }
    }
  }

  return null
}

/** Upstream failure (5xx, timeout): trips the circuit breaker. */
class ServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

/** Only 5xx trips the circuit; 4xx (incl. 401/403 bad key) are expected business errors. */
function shouldTripCircuit(status: number): boolean {
  return status >= 500
}

export interface Token {
  current: number
  max: number
  nextTokenInSeconds?: number
  regenDelayInSeconds: number
}

export interface GuildRaid {
  tokens: Token
  bombTokens: Token
}

export interface TacticusUnit {
  id: string
  name: string
  faction: string
  grandAlliance: string
  progressionIndex: number
  xp: number
  xpLevel: number
  rank: number
  shards: number
  mythicShards: number
  abilities: Array<{
    id: string
    level: number
  }>
  upgrades: number[]
  items: Array<{
    slotId: string
    id: string
    name: string
    rarity: string
    level: number
  }>
}

export interface TacticusPlayer {
  details: {
    name: string
    powerLevel: number
  }
  units?: TacticusUnit[]
  /** The API has used all four keys across versions; read via resolveMachinesOfWar. */
  machinesOfWar?: TacticusUnit[]
  machines_of_war?: TacticusUnit[]
  machineOfWar?: TacticusUnit[]
  machine_of_war?: TacticusUnit[]
  progress?: {
    campaigns?: Array<{
      id: string
      name: string
      type: string
      battles: Array<{
        battleIndex: number
        attemptsLeft: number
        attemptsUsed: number
      }>
    }>
    legendaryEvents?: Array<{
      id: string
      currentPoints?: number
      currentCurrency?: number
      currentShards?: number
    }>
    guildRaid?: GuildRaid
    arena?: {
      tokens: Token
    }
    onslaught?: {
      tokens: Token
    }
    salvageRun?: {
      tokens: Token
    }
    /** Crusade shape is unconfirmed in the public API; typed loosely so ingestion tolerates it. */
    crusade?: {
      seasonId?: string
      side?: string
      points?: number
      tokens?: Token
    } & Record<string, unknown>
  }
  inventory?: {
    items?: Array<{ id: string; name?: string; level: number; amount: number }>
    upgrades?: Array<{ id: string; name?: string; amount: number }>
    shards?: Array<{ id: string; name?: string; amount: number }>
    mythicShards?: Array<{ id: string; name?: string; amount: number }>
    xpBooks?: Array<{ id: string; rarity: string; amount: number }>
    abilityBadges?: Record<
      string,
      Array<{ name?: string; rarity: string; amount: number }>
    >
    components?: Array<{ name: string; grandAlliance: string; amount: number }>
    forgeBadges?: Array<{ name: string; rarity: string; amount: number }>
    orbs?: Record<string, Array<{ rarity: string; amount: number }>>
    requisitionOrders?: { regular: number; blessed: number }
    resetStones?: number
  }
}

export function resolveMachinesOfWar(
  player: TacticusPlayer | Record<string, unknown>
): TacticusUnit[] {
  const p = player as Record<string, unknown>
  const raw =
    p.machinesOfWar ??
    p.machines_of_war ??
    p.machineOfWar ??
    p.machine_of_war ??
    null
  return Array.isArray(raw) ? raw : []
}

export interface TacticusGuildMember {
  userId: string
  role: string
  level: number
  lastActivityOn?: string
}

export interface TacticusGuild {
  guildId: string
  guildTag: string
  name: string
  level: number
  members: TacticusGuildMember[]
  guildRaidSeasons: number[]
}

export interface GuildRaidEntry {
  userId: string
  username: string
  damageType: 'Battle' | 'Bomb'
  startedOn: number // Unix seconds (see normalizeUnixTimestampSeconds)
  completedOn: number
  unitId: string
  damageDealt: number
  encounterType: string
  tier: number
  set: number
}

export interface GuildRaidResponse {
  season: number
  seasonConfigId: string
  entries: GuildRaidEntry[]
}

const UNIX_MILLISECONDS_DIGITS = 13
const UNIX_MICROSECONDS_DIGITS = 16
const UNIX_NANOSECONDS_DIGITS = 19

function getIntegerDigitCount(value: string): number | null {
  const match = value.trim().match(/^-?(\d+)(?:\.\d+)?$/)
  if (!match?.[1]) return null
  return match[1].replace(/^0+/, '').length || 1
}

/**
 * Normalize raid timestamps to Unix seconds. The API may return s/ms/us/ns
 * or numeric strings; downstream token/bomb math assumes seconds.
 */
export function normalizeUnixTimestampSeconds(timestamp: unknown): number {
  const digitCount =
    typeof timestamp === 'string' ? getIntegerDigitCount(timestamp) : null
  const numericTimestamp =
    typeof timestamp === 'number'
      ? timestamp
      : typeof timestamp === 'string' && timestamp.trim().length > 0
        ? Number(timestamp)
        : Number.NaN

  if (!Number.isFinite(numericTimestamp)) return Number.NaN

  const absoluteTimestamp = Math.abs(numericTimestamp)
  const inferredDigitCount =
    digitCount ??
    (absoluteTimestamp > 0 ? Math.floor(Math.log10(absoluteTimestamp)) + 1 : 1)

  if (inferredDigitCount >= UNIX_NANOSECONDS_DIGITS) {
    return Math.trunc(numericTimestamp / 1_000_000_000)
  }
  if (inferredDigitCount >= UNIX_MICROSECONDS_DIGITS) {
    return Math.trunc(numericTimestamp / 1_000_000)
  }
  if (inferredDigitCount >= UNIX_MILLISECONDS_DIGITS) {
    return Math.trunc(numericTimestamp / 1_000)
  }
  return Math.trunc(numericTimestamp)
}

export function normalizeGuildRaidEntryTimestamps(
  entry: GuildRaidEntry
): GuildRaidEntry {
  return {
    ...entry,
    startedOn: normalizeUnixTimestampSeconds(entry.startedOn),
    completedOn: normalizeUnixTimestampSeconds(entry.completedOn)
  }
}

function normalizeGuildRaidResponse(
  data: GuildRaidResponse
): GuildRaidResponse {
  if (!Array.isArray(data.entries)) return data
  return {
    ...data,
    entries: data.entries.map(normalizeGuildRaidEntryTimestamps)
  }
}

export class TacticusAPIClient {
  private baseUrl = TACTICUS_API.BASE_URL

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/player`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-KEY': apiKey
        },
        signal: AbortSignal.timeout(VALIDATE_API_KEY_TIMEOUT_MS)
      })

      return response.ok
    } catch (error: unknown) {
      // pino drops err passed as a format arg; the object goes first.
      const details = extractErrorDetails(error)
      logger.error(
        {
          err: error,
          errMessage: details?.message,
          errName: error instanceof Error ? error.name : undefined,
          status: (error as { status?: number })?.status,
          endpoint: `${this.baseUrl}/player`
        },
        'API key validation failed'
      )
      return false
    }
  }

  async getPlayer(apiKey: string): Promise<TacticusPlayer | null> {
    try {
      logger.debug(
        {
          url: `${this.baseUrl}/player`,
          apiKeyLength: apiKey.length
        },
        'Fetching player from Tacticus API'
      )

      const response = await fetch(`${this.baseUrl}/player`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-KEY': apiKey
        },
        signal: AbortSignal.timeout(GET_PLAYER_TIMEOUT_MS)
      })

      if (!response.ok) {
        let errorBody = ''
        try {
          errorBody = await response.text()
        } catch {
          // ignore
        }
        logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            errorBody
          },
          'Failed to fetch player from Tacticus API'
        )
        return null
      }

      const data = await response.json()
      logger.debug(
        {
          hasData: !!data,
          hasPlayer: !!data?.player,
          keys: data ? Object.keys(data) : []
        },
        'Player API response structure:'
      )

      if (data && data.player) {
        return data.player as TacticusPlayer
      }

      // Some API versions return the player directly without nesting
      if (data && data.details) {
        return data as TacticusPlayer
      }

      logger.warn({ data }, 'Unexpected player API response format')
      return null
    } catch (error: unknown) {
      const details = extractErrorDetails(error)
      logger.error(
        {
          err: error,
          errMessage: details?.message,
          errName: error instanceof Error ? error.name : undefined,
          status: (error as { status?: number })?.status,
          endpoint: `${this.baseUrl}/player`
        },
        'Error fetching player'
      )
      return null
    }
  }

  /**
   * Retrying, circuit-protected fetch. Fan-out callers cap the timeout and disable retries
   * so one bad key cannot park a Promise.allSettled batch for ~80s.
   */
  async getPlayerWithRetry(
    apiKey: string,
    options?: { timeoutMs?: number; maxRetries?: number }
  ): Promise<TacticusPlayer | null> {
    const timeoutMs = options?.timeoutMs ?? PLAYER_API_TIMEOUT
    const maxRetries = options?.maxRetries ?? PLAYER_API_MAX_RETRIES
    try {
      return await tacticusCircuit.execute(async () => {
        logger.debug(
          {
            url: `${this.baseUrl}/player`,
            timeout: timeoutMs,
            maxRetries
          },
          'Fetching player from Tacticus API with retry'
        )

        const response = await withRetry(
          async () => {
            // attemptTimeout only rejects the wrapper; without this signal the
            // orphaned fetch holds its undici connection and starves the pod.
            const res = await fetch(`${this.baseUrl}/player`, {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                'X-API-KEY': apiKey
              },
              signal: AbortSignal.timeout(timeoutMs)
            })
            if (!res.ok && res.status >= 500) {
              throw new ServiceError(
                res.status,
                `Tacticus API: ${res.status} ${res.statusText}`
              )
            }
            return res
          },
          {
            ...TACTICUS_API_POLICY,
            maxAttempts: maxRetries + 1,
            baseDelayMs: PLAYER_API_RETRY_DELAY,
            attemptTimeout: timeoutMs
          }
        )

        if (!response.ok) {
          const status = response.status

          if (shouldTripCircuit(status)) {
            logger.error(
              { status, statusText: response.statusText },
              'Player fetch failed - service error'
            )
            throw new ServiceError(
              status,
              `Tacticus API service error: ${status} ${response.statusText}`
            )
          }

          logger.warn(
            { status, statusText: response.statusText },
            'Player fetch failed - client error (not tripping circuit)'
          )
          return null
        }

        const data = await response.json()

        if (data && data.player) {
          return data.player as TacticusPlayer
        }

        if (data && data.details) {
          return data as TacticusPlayer
        }

        logger.warn({ data }, 'Unexpected player API response format')
        return null
      })
    } catch (error: unknown) {
      if (error instanceof CircuitOpenError) {
        logger.warn(
          {
            timeUntilRetry: error.timeUntilHalfOpen
          },
          'Tacticus API circuit is open, skipping request'
        )
        return null
      }
      const details = extractErrorDetails(error)
      logger.error(
        {
          err: error,
          errMessage: details?.message,
          errName: error instanceof Error ? error.name : undefined,
          status: (error as { status?: number })?.status,
          endpoint: `${this.baseUrl}/player`
        },
        'Error fetching player with retry'
      )
      return null
    }
  }

  async getGuild(apiKey: string): Promise<TacticusGuild | null> {
    try {
      return await tacticusCircuit.execute(async () => {
        const response = await fetch(`${this.baseUrl}/guild`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-API-KEY': apiKey
          },
          signal: AbortSignal.timeout(GET_GUILD_TIMEOUT_MS)
        })

        if (!response.ok) {
          const status = response.status
          if (shouldTripCircuit(status)) {
            logger.error(
              { status, statusText: response.statusText },
              'Guild fetch failed - service error'
            )
            throw new ServiceError(
              status,
              `Tacticus API service error: ${status} ${response.statusText}`
            )
          }
          logger.warn(
            { status, statusText: response.statusText },
            'Guild fetch failed - client error (not tripping circuit)'
          )
          return null
        }

        const data = await response.json()
        if (data && data.guild) {
          return data.guild as TacticusGuild
        }
        return null
      })
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        logger.warn(
          {
            timeUntilRetry: error.timeUntilHalfOpen
          },
          'Tacticus API circuit is open, skipping guild request'
        )
        return null
      }
      const details = extractErrorDetails(error)
      logger.error(
        {
          err: error,
          errMessage: details?.message,
          errName: error instanceof Error ? error.name : undefined,
          status: (error as { status?: number })?.status,
          endpoint: `${this.baseUrl}/guild`
        },
        'Error fetching guild'
      )
      return null
    }
  }

  async getCurrentGuildRaid(apiKey: string): Promise<GuildRaidResponse | null> {
    try {
      return await tacticusCircuit.execute(async () => {
        logger.debug(
          { url: `${this.baseUrl}/guildRaid` },
          'Attempting to fetch guild raid'
        )
        const response = await fetch(`${this.baseUrl}/guildRaid`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-API-KEY': apiKey
          },
          signal: AbortSignal.timeout(GET_GUILD_RAID_TIMEOUT_MS)
        })

        if (!response.ok) {
          const status = response.status

          let errorBody = ''
          try {
            errorBody = await response.text()
          } catch {
            // ignore
          }

          if (shouldTripCircuit(status)) {
            logger.error(
              { status, statusText: response.statusText, errorBody },
              'Guild raid fetch failed - service error'
            )
            throw new ServiceError(
              status,
              `Tacticus API service error: ${status} ${response.statusText}`
            )
          }

          logger.warn(
            { status, statusText: response.statusText, errorBody },
            'Guild raid fetch failed - client error (not tripping circuit)'
          )
          return null
        }

        const data = await response.json()
        logger.debug(
          {
            hasData: !!data,
            season: data?.season,
            entriesCount: data?.entries?.length || 0
          },
          'Guild raid response received:'
        )

        return normalizeGuildRaidResponse(data as GuildRaidResponse)
      })
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        logger.warn(
          {
            timeUntilRetry: error.timeUntilHalfOpen
          },
          'Tacticus API circuit is open, skipping guild raid request'
        )
        return null
      }
      const details = extractErrorDetails(error)
      logger.error(
        {
          err: error,
          errMessage: details?.message,
          errName: error instanceof Error ? error.name : undefined,
          errStack: details?.stack,
          status: (error as { status?: number })?.status,
          endpoint: `${this.baseUrl}/guildRaid`
        },
        'Error fetching guild raid'
      )
      return null
    }
  }

  async getGuildRaidBySeason(
    apiKey: string,
    season: number
  ): Promise<GuildRaidResponse | null> {
    try {
      return await tacticusCircuit.execute(async () => {
        const response = await fetch(`${this.baseUrl}/guildRaid/${season}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-API-KEY': apiKey
          },
          signal: AbortSignal.timeout(GET_GUILD_RAID_TIMEOUT_MS)
        })

        if (!response.ok) {
          const status = response.status
          if (shouldTripCircuit(status)) {
            logger.error(
              { status, statusText: response.statusText, season },
              'Guild raid season fetch failed - service error'
            )
            throw new ServiceError(
              status,
              `Tacticus API service error: ${status} ${response.statusText}`
            )
          }
          logger.warn(
            { status, statusText: response.statusText, season },
            'Guild raid season fetch failed - client error (not tripping circuit)'
          )
          return null
        }

        return normalizeGuildRaidResponse(
          (await response.json()) as GuildRaidResponse
        )
      })
    } catch (error: unknown) {
      if (error instanceof CircuitOpenError) {
        logger.warn(
          {
            timeUntilRetry: error.timeUntilHalfOpen,
            season
          },
          'Tacticus API circuit is open, skipping guild raid season request'
        )
        return null
      }
      const details = extractErrorDetails(error)
      logger.error(
        {
          err: error,
          errMessage: details?.message,
          errName: error instanceof Error ? error.name : undefined,
          status: (error as { status?: number })?.status,
          endpoint: `${this.baseUrl}/guildRaid/${season}`,
          season
        },
        'Error fetching guild raid for season'
      )
      return null
    }
  }
}

export const tacticusAPI = new TacticusAPIClient()

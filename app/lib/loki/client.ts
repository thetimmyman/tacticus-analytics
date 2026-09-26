import 'server-only'

import { API_REQUEST_CONFIG, API_URLS } from '@tacticus/app-core/api-constants'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.loki.client')

import type {
  LokiCredentials,
  LokiDeviceMetadata,
  LokiEventPayload,
  LokiRequestOptions,
  LokiRequestResult,
  LokiSessionInfo,
  LokiError,
  LokiPlayerInfoResponse
} from '@/app/lib/loki/types'
import { sleep } from '@/app/lib/utils/async-timeout'
import {
  PUBLIC_LOKI_DEVICE_ID,
  PUBLIC_LOKI_INSTALL_ID
} from '@/app/lib/loki/public-device'
import { findLokiSessionId } from '@/app/lib/loki/session-refresh'

type JsonBoundary = unknown

const DEFAULT_CONNECT_GAME_CONFIG = '706f74cc2d10c3547d81b89417afba20'
const DEFAULT_VIEW_GUILD_GAME_CONFIG = '75da56c8362630f0ff1838e76b4c6e54'
const DEFAULT_LEADERBOARD_GAME_CONFIG = '9517a7dd237edad05a86e948e469c631'

const SESSION_ERROR_PATTERNS = [
  'invalid_session',
  'incorrect session key',
  'session expired'
]

// buildString stays numeric: every CONNECT sends it and only numeric values are known to be accepted.
const DEFAULT_DEVICE: LokiDeviceMetadata = {
  installId: PUBLIC_LOKI_INSTALL_ID,
  deviceId: PUBLIC_LOKI_DEVICE_ID,
  platform: 'Windows',
  store: 'WebStore',
  buildString: '1.29.21.1056',
  os: 'Windows 11',
  model: 'TacticusAnalytics',
  manufacturer: 'Tacticus Analytics',
  locale: 'en-US',
  countryCode: 'US'
}

const buildUrl = (baseUrl: string, path: string): string => {
  const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const trimmedPath = path.startsWith('/') ? path.slice(1) : path
  return `${trimmedBase}/${trimmedPath}`
}

const safeJsonParse = (value: string): JsonBoundary => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    logger.warn({ error: error }, '[LokiClient] Failed to parse JSON response')
    return null
  }
}

const mergeDeviceMetadata = (
  overrides?: Partial<LokiDeviceMetadata>
): LokiDeviceMetadata => ({
  installId: overrides?.installId ?? DEFAULT_DEVICE.installId,
  deviceId: overrides?.deviceId ?? DEFAULT_DEVICE.deviceId,
  platform: overrides?.platform ?? DEFAULT_DEVICE.platform,
  store: overrides?.store ?? DEFAULT_DEVICE.store,
  buildString: overrides?.buildString ?? DEFAULT_DEVICE.buildString,
  os: overrides?.os ?? DEFAULT_DEVICE.os,
  model: overrides?.model ?? DEFAULT_DEVICE.model,
  manufacturer: overrides?.manufacturer ?? DEFAULT_DEVICE.manufacturer,
  locale: overrides?.locale ?? DEFAULT_DEVICE.locale,
  countryCode: overrides?.countryCode ?? DEFAULT_DEVICE.countryCode
})

export interface LokiClientOptions {
  baseUrl?: string
  requestTimeoutMs?: number
  retryAttempts?: number
  retryDelayMs?: number
  defaultGameConfigVersion?: string
  connectGameConfigVersion?: string
  leaderboardGameConfigVersion?: string
  onSessionUpdate?: (info: LokiSessionInfo) => void | Promise<void>
  fetchImpl?: typeof fetch
}

interface InternalRequestResult<T> {
  ok: boolean
  data?: T
  raw: unknown
  response?: Response
  error?: LokiError
  sessionId?: string
}

export class LokiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly retryAttempts: number
  private readonly retryDelayMs: number
  private defaultGameConfigVersion: string
  private connectGameConfigVersion: string
  private leaderboardGameConfigVersion: string
  private readonly onSessionUpdate?: (
    info: LokiSessionInfo
  ) => void | Promise<void>
  private readonly fetchImpl: typeof fetch
  private readonly credentials: LokiCredentials

  constructor(credentials: LokiCredentials, options?: LokiClientOptions) {
    this.credentials = { ...credentials }
    this.baseUrl = options?.baseUrl ?? API_URLS.TACTICUS.LOKI
    this.timeoutMs =
      options?.requestTimeoutMs ?? API_REQUEST_CONFIG.TIMEOUTS.SHORT
    this.retryAttempts = Math.max(
      options?.retryAttempts ?? API_REQUEST_CONFIG.RETRY.MAX_ATTEMPTS - 1,
      0
    )
    this.retryDelayMs =
      options?.retryDelayMs ?? API_REQUEST_CONFIG.RETRY.DEFAULT_DELAY
    this.defaultGameConfigVersion =
      options?.defaultGameConfigVersion ?? DEFAULT_VIEW_GUILD_GAME_CONFIG
    this.connectGameConfigVersion =
      options?.connectGameConfigVersion ?? DEFAULT_CONNECT_GAME_CONFIG
    this.leaderboardGameConfigVersion =
      options?.leaderboardGameConfigVersion ?? DEFAULT_LEADERBOARD_GAME_CONFIG
    this.onSessionUpdate = options?.onSessionUpdate
    this.fetchImpl = options?.fetchImpl ?? fetch
  }

  public get sessionId(): string | null {
    return this.credentials.sessionId ?? null
  }

  public get device(): LokiDeviceMetadata {
    return mergeDeviceMetadata(this.credentials.device)
  }

  private async notifySession(
    sessionId: string,
    raw: JsonBoundary
  ): Promise<void> {
    if (this.onSessionUpdate) {
      await this.onSessionUpdate({
        sessionId,
        fetchedAt: new Date().toISOString(),
        raw
      })
    }
  }

  private buildEventPayload<Data extends Record<string, unknown> | undefined>(
    options: LokiRequestOptions<Data>,
    sessionId?: string | null
  ): LokiEventPayload<Data> {
    const createdOn = Date.now().toString()
    const payload: LokiEventPayload<Data> = {
      playerEvent: {
        playerEventType: options.eventType,
        playerEventData: (options.eventData ?? {}) as Data,
        universeVersion: options.universeVersion ?? 'universe_not_needed',
        gameConfigVersion:
          options.gameConfigVersion ??
          (options.eventType === 'GET_GUILD_SEASON_LEADERBOARD' ||
          options.eventType === 'GET_GUILD_WAR_LEADERBOARD'
            ? this.leaderboardGameConfigVersion
            : this.defaultGameConfigVersion),
        multiConfigVersion: options.multiConfigVersion ?? '',
        createdOn
      },
      builtInMultiConfigVersion: '',
      installId: options.installId ?? this.device.installId
    }

    if (sessionId) {
      const data = payload.playerEvent.playerEventData as Record<
        string,
        unknown
      >
      if (!data.sessionId) {
        data.sessionId = sessionId
      }
      if (!data.userId) {
        data.userId = this.credentials.userId
      }
    }

    return payload
  }

  private buildConnectPayload(): LokiEventPayload {
    const device = this.device

    return {
      playerEvent: {
        playerEventType: 'CONNECT',
        playerEventData: {
          userId: this.credentials.userId,
          clientSecret: this.credentials.clientSecret,
          deviceData: {
            installId: device.installId,
            deviceId: device.deviceId,
            countryCode: device.countryCode,
            locale: device.locale,
            manufacturer: device.manufacturer,
            model: device.model,
            os: device.os,
            buildString: device.buildString,
            platform: device.platform,
            store: device.store
          }
        },
        universeVersion: 'universe_not_needed',
        gameConfigVersion: this.connectGameConfigVersion,
        createdOn: Date.now().toString(),
        multiConfigVersion: ''
      },
      builtInMultiConfigVersion: '',
      installId: device.installId
    }
  }

  private createError(
    message: string,
    status?: number,
    raw?: JsonBoundary,
    cause?: JsonBoundary,
    markAuth = false
  ): LokiError {
    const normalizedMessage = message ?? 'Unknown LOKI error'
    const isAuthError =
      markAuth ||
      (typeof status === 'number' &&
        (status === 401 ||
          status === 403 ||
          SESSION_ERROR_PATTERNS.some((pattern) =>
            normalizedMessage.toLowerCase().includes(pattern)
          )))

    return {
      message: normalizedMessage,
      status,
      raw,
      cause,
      isAuthError
    }
  }

  private shouldRefreshFromBody(body: string): boolean {
    const lower = body.toLowerCase()
    return SESSION_ERROR_PATTERNS.some((pattern) =>
      lower.includes(pattern.toLowerCase())
    )
  }

  private async postJson(
    path: string,
    body: unknown,
    timeoutMs?: number,
    headers?: Record<string, string>
  ): Promise<{
    response: Response
    text: string
    json: unknown
  }> {
    const url = buildUrl(this.baseUrl, path)
    const controller = new AbortController()
    const effectiveTimeout = timeoutMs ?? this.timeoutMs
    const timer = setTimeout(() => controller.abort(), effectiveTimeout)

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(headers ?? {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      const text = await response.text()
      const json = safeJsonParse(text)
      return { response, text, json }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw this.createError(
          `LOKI request timed out after ${effectiveTimeout}ms`,
          undefined,
          null,
          error
        )
      }
      throw this.createError('Failed to reach LOKI API', undefined, null, error)
    } finally {
      clearTimeout(timer)
    }
  }

  private async executeRequest<
    TResponse,
    TData extends Record<string, unknown> | undefined
  >(
    options: LokiRequestOptions<TData>
  ): Promise<InternalRequestResult<TResponse>> {
    let sessionId = options.sessionId ?? this.credentials.sessionId ?? null

    if (!sessionId) {
      const refreshed = await this.refreshSessionInternal()
      if (!refreshed.ok || !refreshed.sessionId) {
        return {
          ok: false,
          raw: refreshed.raw,
          error:
            refreshed.error ??
            this.createError(
              'Failed to obtain a valid LOKI session',
              undefined,
              refreshed.raw,
              undefined,
              true
            )
        }
      }
      sessionId = refreshed.sessionId
    }

    const payload = this.buildEventPayload(options, sessionId)
    const path =
      options.path ??
      `player/player2/userId/${this.credentials.userId}/sessionId/${sessionId}`

    const { response, text, json } = await this.postJson(
      path,
      payload,
      options.timeoutMs,
      options.headers
    )

    if (!response.ok) {
      const error = this.createError(
        `LOKI responded with ${response.status}`,
        response.status,
        json ?? text
      )
      return {
        ok: false,
        raw: json ?? text,
        response,
        error
      }
    }

    const nextSession = findLokiSessionId(json)
    if (nextSession && nextSession !== sessionId) {
      this.credentials.sessionId = nextSession
      await this.notifySession(nextSession, json)
      sessionId = nextSession
    }

    return {
      ok: true,
      data: json as TResponse,
      raw: json,
      response,
      sessionId
    }
  }

  private async refreshSessionInternal(): Promise<{
    ok: boolean
    sessionId?: string
    raw: unknown
    error?: LokiError
  }> {
    if (!this.credentials.clientSecret) {
      return {
        ok: false,
        raw: null,
        error: this.createError(
          'Client secret is required to refresh LOKI session',
          undefined,
          null,
          null,
          true
        )
      }
    }

    const path = `player/player2/userId/${this.credentials.userId}`
    try {
      const { response, text, json } = await this.postJson(
        path,
        this.buildConnectPayload()
      )

      if (!response.ok) {
        const error = this.createError(
          `LOKI connect failed with ${response.status}`,
          response.status,
          json ?? text,
          undefined,
          true
        )
        return { ok: false, raw: json ?? text, error }
      }

      const sessionId = findLokiSessionId(json)
      if (!sessionId) {
        const error = this.createError(
          'LOKI connect succeeded but no sessionId was returned',
          response.status,
          json,
          undefined,
          true
        )
        return { ok: false, raw: json, error }
      }

      this.credentials.sessionId = sessionId
      await this.notifySession(sessionId, json)
      return { ok: true, sessionId, raw: json }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'message' in (error as { message?: unknown })
      ) {
        const errObj = error as { message?: string; status?: number }
        return { ok: false, raw: null, error: errObj as LokiError }
      }
      return {
        ok: false,
        raw: null,
        error: this.createError(
          'Unexpected error during LOKI connect',
          undefined,
          null,
          error,
          true
        )
      }
    }
  }

  public async refreshSession(): Promise<LokiRequestResult<LokiSessionInfo>> {
    const result = await this.refreshSessionInternal()
    if (!result.ok || !result.sessionId) {
      return {
        ok: false,
        error:
          result.error ??
          this.createError(
            'Failed to refresh session',
            undefined,
            result.raw,
            undefined,
            true
          )
      }
    }
    return {
      ok: true,
      data: {
        sessionId: result.sessionId,
        fetchedAt: new Date().toISOString(),
        raw: result.raw
      },
      raw: result.raw
    }
  }

  public async request<
    TResponse = unknown,
    TData extends Record<string, unknown> | undefined = Record<string, unknown>
  >(options: LokiRequestOptions<TData>): Promise<LokiRequestResult<TResponse>> {
    let attempt = 0
    let authRefreshAttempted = false
    let lastError: LokiError | null = null

    while (attempt <= this.retryAttempts) {
      try {
        const result = await this.executeRequest<TResponse, TData>(options)

        if (!result.ok) {
          const error = result.error ?? this.createError('Unknown LOKI error')

          if (
            error.isAuthError ||
            (typeof result.raw === 'string' &&
              this.shouldRefreshFromBody(result.raw))
          ) {
            if (authRefreshAttempted) {
              return { ok: false, error }
            }
            authRefreshAttempted = true
            logger.warn(
              { data: error.message },
              '[LokiClient] Session appears invalid, attempting automatic refresh'
            )
            const refreshed = await this.refreshSessionInternal()
            if (refreshed.ok && refreshed.sessionId) {
              continue
            }
            return {
              ok: false,
              error: refreshed.error ?? error
            }
          }

          lastError = error
        } else {
          return {
            ok: true,
            data: result.data as TResponse,
            raw: result.raw,
            sessionId: result.sessionId
          }
        }
      } catch (error: unknown) {
        const wrappedError =
          error && typeof error === 'object' && 'message' in error
            ? (error as LokiError)
            : this.createError(
                'Unexpected LOKI client error',
                undefined,
                null,
                error
              )
        lastError = wrappedError
      }

      attempt += 1
      if (attempt <= this.retryAttempts) {
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1)
        logger.debug(
          { tag: 'LokiClient', eventType: options.eventType, attempt, delay },
          'retrying request'
        )
        await sleep(delay)
      }
    }

    return {
      ok: false,
      error: lastError ?? this.createError('Unknown LOKI error')
    }
  }

  public async fetchGuildView<TResponse = unknown>(
    guildId: string
  ): Promise<LokiRequestResult<TResponse>> {
    return this.request<TResponse>({
      eventType: 'VIEW_GUILD_2',
      eventData: { guildId },
      gameConfigVersion: this.defaultGameConfigVersion,
      tag: 'VIEW_GUILD_2'
    })
  }

  public async getPlayerInfo(
    requestedUserId: string
  ): Promise<LokiRequestResult<LokiPlayerInfoResponse>> {
    const result = await this.request<{
      eventResult?: { eventResponseData?: LokiPlayerInfoResponse }
    }>({
      eventType: 'GET_PLAYER_INFO',
      eventData: { requestedUserId },
      gameConfigVersion: this.defaultGameConfigVersion,
      tag: 'GET_PLAYER_INFO'
    })

    if (!result.ok) {
      return result
    }

    const playerInfo = result.data?.eventResult?.eventResponseData
    if (!playerInfo) {
      return {
        ok: false,
        error: this.createError(
          'No player info in response',
          undefined,
          result.raw
        )
      }
    }

    return {
      ok: true,
      data: playerInfo,
      raw: result.raw,
      sessionId: result.sessionId
    }
  }
}

export const createLokiClient = (
  credentials: LokiCredentials,
  options?: LokiClientOptions
): LokiClient => new LokiClient(credentials, options)

export const GAME_CONFIG_VERSIONS = {
  CONNECT: DEFAULT_CONNECT_GAME_CONFIG,
  VIEW_GUILD: DEFAULT_VIEW_GUILD_GAME_CONFIG,
  LEADERBOARD: DEFAULT_LEADERBOARD_GAME_CONFIG
} as const

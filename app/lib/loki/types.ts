import 'server-only'

export interface LokiDeviceMetadata {
  installId: string
  deviceId: string
  platform: string
  store: string
  buildString: string
  os: string
  model: string
  manufacturer: string
  locale: string
  countryCode: string
}

export interface LokiCredentials {
  userId: string
  sessionId?: string | null
  clientSecret: string
  device?: Partial<LokiDeviceMetadata>
}

export interface LokiSessionInfo {
  sessionId: string
  fetchedAt: string
  raw: unknown
}

export interface LokiError {
  message: string
  status?: number
  code?: string
  isAuthError?: boolean
  raw?: unknown
  cause?: unknown
}

export interface LokiRequestContext {
  timeoutMs?: number
  headers?: Record<string, string>
  path?: string
}

export interface LokiEventPayload<Data = Record<string, unknown>> {
  playerEvent: {
    playerEventType: string
    playerEventData: Data
    universeVersion?: string
    gameConfigVersion?: string
    multiConfigVersion?: string
    createdOn: string
  }
  builtInMultiConfigVersion?: string
  installId?: string
}

export interface LokiRequestOptions<
  Data = Record<string, unknown>
> extends LokiRequestContext {
  eventType: string
  eventData?: Data
  gameConfigVersion?: string
  sessionId?: string
  universeVersion?: string
  multiConfigVersion?: string
  installId?: string
  tag?: string
}

export type LokiRequestResult<T> =
  | {
      ok: true
      data: T
      sessionId?: string
      raw: unknown
    }
  | {
      ok: false
      error: LokiError
    }

export interface LokiGuildWarLevelZone {
  warZoneType: string
  zoneTierId: string
  raw?: unknown
}

export interface LokiGuildWarLevel {
  battlefieldLevel: number
  minGuildPower: number | null
  minOptedInPlayers: number | null
  zones: LokiGuildWarLevelZone[]
  raw?: unknown
}

export interface LokiGuildWarZoneTier {
  zoneTierId: string
  npcUnitId: string | null
  rarityCaps: string[]
  raw?: unknown
}

export interface LokiGuildWarSeasonConfig {
  id: string
  maxAttempts: number | null
  activeEncounterLockedMinutes: number | null
  scorePerZoneType: Record<string, number>
  defaultZoneTypeLayout: string[][]
  zoneTypeConfigs: Record<
    string,
    {
      visualId?: string
      canBeMoved?: boolean
      buffs?: string[]
      [key: string]: unknown
    }
  >
  levels: LokiGuildWarLevel[]
  zoneTiers: LokiGuildWarZoneTier[]
  raw?: unknown
}

export interface LokiGlobalConfig {
  guildBoss?: Record<string, unknown>
  guildWar?: Record<string, unknown>
  guild?: Record<string, unknown>
  general?: Record<string, unknown>
  pvp?: Record<string, unknown>
  [key: string]: unknown
}

export interface LokiGlobalConfigSnapshot {
  config: LokiGlobalConfig
  fetchedAt: string
  source: 'network' | 'disk'
}

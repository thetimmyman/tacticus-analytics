import { normalizeGuildCode } from '../_shared/guild-code.ts'

export interface SyncRequestContext {
  guildCode: string
  correlationId: string
  requestedSeason: number | null
  skipNotifications: boolean
  preserveSyncSettings: boolean
  freshSessionId: string | null
  explicitApiKey: string | null
}

export function parseSyncRequestContext(
  body: unknown,
  createCorrelationId: () => string = () => crypto.randomUUID()
): SyncRequestContext {
  const input =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  return {
    guildCode: normalizeGuildCode(input.guild_code),
    correlationId:
      typeof input.correlation_id === 'string' && input.correlation_id
        ? input.correlation_id
        : createCorrelationId(),
    // Preserve invalid explicit input so the handler rejects it, never syncs live.
    requestedSeason:
      input.season === undefined || input.season === null
        ? null
        : typeof input.season === 'number'
          ? input.season
          : Number.NaN,
    skipNotifications:
      input.skip_notifications === true || input.dr_mode === true,
    preserveSyncSettings: input.preserve_sync_settings === true,
    // Pre-refreshed LOKI session from batch cron (avoids per-guild CONNECT thundering herd)
    freshSessionId:
      typeof input.fresh_session_id === 'string'
        ? input.fresh_session_id.trim()
        : null,
    explicitApiKey:
      typeof input.api_key === 'string' ? input.api_key.trim() : null
  }
}

export function parseLatestSeason(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseLiveRaidSeason(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const body =
    record.body &&
    typeof record.body === 'object' &&
    !Array.isArray(record.body)
      ? (record.body as Record<string, unknown>)
      : null
  return parseLatestSeason(
    record.season ?? record.currentSeason ?? body?.season ?? body?.currentSeason
  )
}

export interface NormalizedRaidPayload {
  valid: boolean
  entries: unknown[]
  season: number | null
}

/** Validate season metadata before using raid data; live feeds must carry it. */
export function normalizeRaidPayload(
  value: unknown,
  options: { isHistorical: boolean; requestedSeason: number | null }
): NormalizedRaidPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, entries: [], season: null }
  }
  const record = value as Record<string, unknown>
  const body =
    record.body &&
    typeof record.body === 'object' &&
    !Array.isArray(record.body)
      ? (record.body as Record<string, unknown>)
      : null
  const entries = record.entries ?? body?.entries
  const hasSeasonMetadata =
    Object.hasOwn(record, 'season') ||
    Object.hasOwn(record, 'currentSeason') ||
    (body !== null &&
      (Object.hasOwn(body, 'season') || Object.hasOwn(body, 'currentSeason')))
  const season = hasSeasonMetadata ? parseLiveRaidSeason(record) : null
  const requestedSeason = options.requestedSeason

  if (!Array.isArray(entries)) return { valid: false, entries: [], season }
  if (options.isHistorical) {
    const valid =
      requestedSeason !== null &&
      (hasSeasonMetadata ? season === requestedSeason : true)
    return { valid, entries, season: requestedSeason }
  }

  const valid =
    season !== null && (requestedSeason === null || requestedSeason === season)
  return { valid, entries, season }
}

export function isHistoricalSeason(
  requestedSeason: number | null,
  currentSeason: number | null
): boolean {
  return (
    requestedSeason !== null &&
    currentSeason !== null &&
    requestedSeason < currentSeason
  )
}

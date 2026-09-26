export type SyncFeedKey = 'raid'

export interface SyncFeedDefinition {
  key: SyncFeedKey
  label: string
  cronJob: string
  cronSchedule: string
  cadenceSeconds: number
}

/** The 5-min cron is only the realtime enqueue cadence; judging every guild by it flags hourly tiers. */
export const SYNC_FEEDS: readonly SyncFeedDefinition[] = [
  {
    key: 'raid',
    label: 'Raid sync',
    cronJob: 'guild-realtime-sync',
    cronSchedule: '*/5 * * * *',
    // Fallback only; callers resolve the guild's real cadence.
    cadenceSeconds: 60 * 60
  }
] as const

/** Mirrors `guild-batch-sync`'s stale thresholds; keep in step or the readout invents or hides alarms. */
export const SYNC_TIER_CADENCE_SECONDS: Record<string, number> = {
  active: 60 * 60,
  warm: 4 * 60 * 60,
  dormant: 12 * 60 * 60
}

export const REALTIME_CADENCE_SECONDS = 90

export function resolveRaidCadenceSeconds(guild: {
  realtimeSync?: boolean | null
  syncTier?: string | null
}): number {
  if (guild.realtimeSync === true) return REALTIME_CADENCE_SECONDS
  const tier = guild.syncTier ?? 'active'
  return (
    SYNC_TIER_CADENCE_SECONDS[tier] ??
    SYNC_TIER_CADENCE_SECONDS.active ??
    60 * 60
  )
}

/** `never` is distinct from `overdue`: there is no age to report. */
export type SyncFeedStatus = 'current' | 'late' | 'overdue' | 'never'

export interface SyncFeedReading {
  key: SyncFeedKey
  label: string
  cadenceSeconds: number
  cadenceLabel: string
  ageSeconds: number | null
  status: SyncFeedStatus
  ageLabel: string
}

/** One missed cycle is normal jitter; beyond three the feed is not running. */
export function feedStatus(
  ageSeconds: number | null,
  cadenceSeconds: number
): SyncFeedStatus {
  if (ageSeconds === null || !Number.isFinite(ageSeconds)) return 'never'
  const cadence = cadenceSeconds > 0 ? cadenceSeconds : 1
  if (ageSeconds <= cadence * 2) return 'current'
  if (ageSeconds <= cadence * 6) return 'late'
  return 'overdue'
}

export function formatAge(ageSeconds: number | null): string {
  if (ageSeconds === null || !Number.isFinite(ageSeconds)) return 'never'
  const s = Math.max(0, Math.floor(ageSeconds))
  if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export function formatCadence(cadenceSeconds: number): string {
  if (!Number.isFinite(cadenceSeconds) || cadenceSeconds <= 0) return 'unknown'
  if (cadenceSeconds < 3600)
    return `every ${Math.round(cadenceSeconds / 60)} min`
  const hours = cadenceSeconds / 3600
  if (hours < 24) {
    return `every ${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
  }
  const days = hours / 24
  return `every ${Number.isInteger(days) ? days : days.toFixed(1)}d`
}

/** `lastSyncAt` is the last successful ingest, never an attempt, so an always-failing feed reads as stopped. */
export function readFeed(
  definition: SyncFeedDefinition,
  lastSyncAt: number | null,
  nowMs: number,
  cadenceSecondsOverride?: number | null
): SyncFeedReading {
  const cadenceSeconds =
    typeof cadenceSecondsOverride === 'number' &&
    Number.isFinite(cadenceSecondsOverride) &&
    cadenceSecondsOverride > 0
      ? cadenceSecondsOverride
      : definition.cadenceSeconds

  const ageSeconds =
    lastSyncAt === null || !Number.isFinite(lastSyncAt)
      ? null
      : // Clamp: clock skew must not yield a negative age or "overdue".
        Math.max(0, Math.floor((nowMs - lastSyncAt) / 1000))

  return {
    key: definition.key,
    label: definition.label,
    cadenceSeconds,
    cadenceLabel: formatCadence(cadenceSeconds),
    ageSeconds,
    status: feedStatus(ageSeconds, cadenceSeconds),
    ageLabel: formatAge(ageSeconds)
  }
}

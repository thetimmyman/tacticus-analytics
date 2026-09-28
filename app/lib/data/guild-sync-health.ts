export const SYNC_STALE_AFTER_HOURS = 24

export type DeadSyncReason =
  'invalid_key' | 'no_key' | 'auto_sync_off' | 'stale'

export interface GuildSyncStateInput {
  api_key_is_valid: boolean | null
  auto_sync_enabled: boolean | null
  last_successful_sync: string | null
  created_at: string | null
}

const HOUR_MS = 60 * 60 * 1000

function toEpochMs(value: string | null): number | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getTime()
}

// A guild is "stale" only when its most recent sync is older than the window, or it has never synced and is older than the window.
function isStale(
  row: GuildSyncStateInput,
  now: Date,
  staleAfterMs: number
): boolean {
  const lastSyncMs = toEpochMs(row.last_successful_sync)
  if (lastSyncMs !== null) return now.getTime() - lastSyncMs > staleAfterMs
  const createdAtMs = toEpochMs(row.created_at)
  if (createdAtMs === null) return false
  return now.getTime() - createdAtMs > staleAfterMs
}

export function classifyGuildSyncState(
  row: GuildSyncStateInput,
  now: Date = new Date(),
  staleAfterHours: number = SYNC_STALE_AFTER_HOURS
): DeadSyncReason | null {
  const hours =
    Number.isFinite(staleAfterHours) && staleAfterHours > 0
      ? staleAfterHours
      : SYNC_STALE_AFTER_HOURS

  if (row.api_key_is_valid === false) return 'invalid_key'

  const dead =
    row.auto_sync_enabled !== true || isStale(row, now, hours * HOUR_MS)
  if (!dead) return null

  if (row.api_key_is_valid === null) return 'no_key'
  if (row.auto_sync_enabled !== true) return 'auto_sync_off'
  return 'stale'
}

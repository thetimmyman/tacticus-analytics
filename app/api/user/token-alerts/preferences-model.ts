import { Errors } from '@/app/lib/errors/AppError'
import {
  DEFAULT_TOKEN_ALERT_PREFS,
  type TokenAlertPrefs
} from '@/app/lib/token-alerts/preferences-defaults'

export type { TokenAlertPrefs } from '@/app/lib/token-alerts/preferences-defaults'

export const DEFAULT_PREFS: TokenAlertPrefs = DEFAULT_TOKEN_ALERT_PREFS

const MIN_ALERT_BEFORE_FULL_MINUTES = 15
const MAX_ALERT_BEFORE_FULL_MINUTES = 720
const MIN_FULL_REPEAT_HOURS = 11
const MAX_FULL_REPEAT_HOURS = 168

/** Ceiling is 960, not the 1080-minute regen (1080 means "always"). Mirrors the
 *  DB CHECK and MAX_BOMB_PREWARN_MINUTES. */
const MIN_ALERT_BEFORE_BOMB_MINUTES = 15
const MAX_ALERT_BEFORE_BOMB_MINUTES = 960

/** Mirrors the DB CHECK and MAX_PRE_QUIET_MINUTES. */
const MIN_ALERT_BEFORE_QUIET_MINUTES = 15
const MAX_ALERT_BEFORE_QUIET_MINUTES = 180

/** Mirrors the DB CHECK and MAX_BURN_PREWARN_MINUTES; must stay below the 11h
 *  burn re-alert hysteresis or a cycle's warning is swallowed. */
const MIN_ALERT_BEFORE_BURN_MINUTES = 15
const MAX_ALERT_BEFORE_BURN_MINUTES = 360

const MAX_TIMEZONE_LENGTH = 64

export const PREFS_COLUMNS =
  'alert_on_full, alert_on_full_repeat_hours, alert_before_full, alert_before_full_minutes, alert_on_token_gained, alert_on_bomb_ready, alert_before_bomb_ready, alert_before_bomb_ready_minutes, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, alert_before_quiet_hours, alert_before_quiet_hours_minutes, alert_before_burn, alert_before_burn_minutes'

/** `updated_at` is the row version for savePrefsMerged's optimistic concurrency. */
export const PREFS_COLUMNS_WITH_VERSION = `${PREFS_COLUMNS}, updated_at`

/** IANA name shape; rejects offset ids like `+05:00` that Intl accepts but
 *  pg_timezone_names lacks (they would pin quiet hours and ignore DST). */
const IANA_ZONE_NAME = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)*$/

/** null without `Intl.supportedValuesOf`. */
let canonicalZonesCache: ReadonlySet<string> | null | undefined

function canonicalZones(): ReadonlySet<string> | null {
  if (canonicalZonesCache === undefined) {
    try {
      canonicalZonesCache =
        typeof Intl.supportedValuesOf === 'function'
          ? new Set(Intl.supportedValuesOf('timeZone'))
          : null
    } catch {
      canonicalZonesCache = null
    }
  }
  return canonicalZonesCache
}

/**
 * The only check that the zone is in pg_timezone_names (a CHECK cannot subquery).
 * Tries the Intl canonical list, a resolvedOptions round-trip, then link names.
 */
export function isIanaTimeZone(value: string): boolean {
  if (!IANA_ZONE_NAME.test(value)) return false

  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat('en-US', {
      timeZone: value,
      hour: '2-digit',
      hour12: false
    }).resolvedOptions().timeZone
  } catch {
    return false
  }

  if (canonicalZones()?.has(value)) return true
  if (resolved === value) return true
  if (value.toLowerCase() === resolved.toLowerCase()) return false
  return true
}

export type PutBody = Record<string, unknown>

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw Errors.validation(`${field} must be a boolean`)
  }
  return value
}

function requireMinutes(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw Errors.validation(
      `${field} must be an integer between ${min} and ${max}`
    )
  }
  return value
}

function requireNullableHours(
  value: unknown,
  field: string,
  min: number,
  max: number
): number | null {
  if (value == null) return null
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw Errors.validation(
      `${field} must be null or an integer between ${min} and ${max}`
    )
  }
  return value
}

/** Whole local hour 0..23; null clears (absent keys are already merged). */
function parseQuietHour(value: unknown, field: string): number | null {
  if (value == null) return null
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 23
  ) {
    throw Errors.validation(
      `${field} must be a whole hour between 0 and 23, or null to disable quiet hours`
    )
  }
  return value as number
}

/**
 * All-three-or-none (turns the DB CHECK's opaque 500 into a 400), a real IANA
 * zone, and start !== end (an empty window would defer persistent alerts forever).
 */
function validateQuietHours(body: PutBody): {
  quiet_hours_start: number | null
  quiet_hours_end: number | null
  quiet_hours_timezone: string | null
} {
  const start = parseQuietHour(body.quiet_hours_start, 'quiet_hours_start')
  const end = parseQuietHour(body.quiet_hours_end, 'quiet_hours_end')

  const rawZone = body.quiet_hours_timezone
  let timezone: string | null = null
  if (rawZone != null) {
    if (typeof rawZone !== 'string') {
      throw Errors.validation('quiet_hours_timezone must be a string or null')
    }
    const trimmed = rawZone.trim()
    timezone = trimmed === '' ? null : trimmed
  }

  const setCount = [start, end, timezone].filter((v) => v != null).length
  if (setCount === 0) {
    return {
      quiet_hours_start: null,
      quiet_hours_end: null,
      quiet_hours_timezone: null
    }
  }
  if (setCount !== 3) {
    throw Errors.validation(
      'quiet hours need all of quiet_hours_start, quiet_hours_end and quiet_hours_timezone, or none of them'
    )
  }

  if (timezone!.length > MAX_TIMEZONE_LENGTH) {
    throw Errors.validation(
      `quiet_hours_timezone must be at most ${MAX_TIMEZONE_LENGTH} characters`
    )
  }
  if (!isIanaTimeZone(timezone!)) {
    throw Errors.validation(
      `quiet_hours_timezone must be a valid IANA timezone name (got "${timezone}")`
    )
  }
  if (start === end) {
    throw Errors.validation(
      'quiet_hours_start and quiet_hours_end must differ — an empty window is not a quiet period; leave quiet hours off instead'
    )
  }

  return {
    quiet_hours_start: start,
    quiet_hours_end: end,
    quiet_hours_timezone: timezone
  }
}

/** Requires quiet hours (mirrors the DB CHECK); the lead counts from quiet_hours_start. */
function validatePreQuiet(
  body: PutBody,
  quietHours: { quiet_hours_start: number | null }
): {
  alert_before_quiet_hours: boolean
  alert_before_quiet_hours_minutes: number
} {
  const enabled = requireBoolean(
    body.alert_before_quiet_hours,
    'alert_before_quiet_hours'
  )
  if (enabled && quietHours.quiet_hours_start == null) {
    throw Errors.validation(
      'alert_before_quiet_hours requires quiet hours to be configured — the lead time is measured from quiet_hours_start'
    )
  }
  return {
    alert_before_quiet_hours: enabled,
    alert_before_quiet_hours_minutes: requireMinutes(
      body.alert_before_quiet_hours_minutes,
      'alert_before_quiet_hours_minutes',
      MIN_ALERT_BEFORE_QUIET_MINUTES,
      MAX_ALERT_BEFORE_QUIET_MINUTES
    )
  }
}

const PREFS_KEYS = Object.keys(DEFAULT_PREFS) as (keyof TokenAlertPrefs)[]

/**
 * Resolves absent keys from the stored row so a partial body from an older
 * client does not reset omitted settings. `undefined` = absent; `null` clears.
 */
export function mergeWithStored(
  body: PutBody,
  stored: TokenAlertPrefs | null
): PutBody {
  const merged: Record<string, unknown> = {}

  for (const key of PREFS_KEYS) {
    if (body[key] !== undefined) {
      merged[key] = body[key]
    } else if (stored && stored[key] !== undefined) {
      merged[key] = stored[key]
    } else {
      merged[key] = DEFAULT_PREFS[key]
    }
  }

  // An older client disabling the parent toggle does not know the cadence field;
  // keeping a stored cadence would reject the disable.
  if (
    body.alert_on_full === false &&
    body.alert_on_full_repeat_hours === undefined
  ) {
    merged.alert_on_full_repeat_hours = null
  }

  // Likewise, pre-quiet follows quiet hours off, as the UI does.
  if (
    body.quiet_hours_start === null &&
    body.alert_before_quiet_hours === undefined
  ) {
    merged.alert_before_quiet_hours = false
  }

  return merged
}

/** Strict; mergeWithStored() runs first, so a missing field is a real defect. */
export function validatePutBody(body: PutBody): TokenAlertPrefs {
  const alertOnFull = requireBoolean(body.alert_on_full, 'alert_on_full')
  const fullRepeatHours = requireNullableHours(
    body.alert_on_full_repeat_hours,
    'alert_on_full_repeat_hours',
    MIN_FULL_REPEAT_HOURS,
    MAX_FULL_REPEAT_HOURS
  )
  if (!alertOnFull && fullRepeatHours != null) {
    throw Errors.validation(
      'alert_on_full_repeat_hours requires alert_on_full to be enabled'
    )
  }

  // validatePreQuiet depends on the normalized triple, not the raw body.
  const quietHours = validateQuietHours(body)

  return {
    alert_on_full: alertOnFull,
    alert_on_full_repeat_hours: fullRepeatHours,
    alert_before_full: requireBoolean(
      body.alert_before_full,
      'alert_before_full'
    ),
    alert_before_full_minutes: requireMinutes(
      body.alert_before_full_minutes,
      'alert_before_full_minutes',
      MIN_ALERT_BEFORE_FULL_MINUTES,
      MAX_ALERT_BEFORE_FULL_MINUTES
    ),
    alert_on_token_gained: requireBoolean(
      body.alert_on_token_gained,
      'alert_on_token_gained'
    ),
    alert_on_bomb_ready: requireBoolean(
      body.alert_on_bomb_ready,
      'alert_on_bomb_ready'
    ),
    alert_before_bomb_ready: requireBoolean(
      body.alert_before_bomb_ready,
      'alert_before_bomb_ready'
    ),
    alert_before_bomb_ready_minutes: requireMinutes(
      body.alert_before_bomb_ready_minutes,
      'alert_before_bomb_ready_minutes',
      MIN_ALERT_BEFORE_BOMB_MINUTES,
      MAX_ALERT_BEFORE_BOMB_MINUTES
    ),
    alert_before_burn: requireBoolean(
      body.alert_before_burn,
      'alert_before_burn'
    ),
    alert_before_burn_minutes: requireMinutes(
      body.alert_before_burn_minutes,
      'alert_before_burn_minutes',
      MIN_ALERT_BEFORE_BURN_MINUTES,
      MAX_ALERT_BEFORE_BURN_MINUTES
    ),
    ...validatePreQuiet(body, quietHours),
    ...quietHours
  }
}

/** A complete body is a plain replace: no read-before-write or concurrency guard. */
export function isCompleteBody(body: PutBody): boolean {
  return PREFS_KEYS.every((key) => body[key] !== undefined)
}

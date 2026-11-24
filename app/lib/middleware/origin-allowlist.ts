import { APP_ORIGINS } from '@tacticus/app-core/app-config'

/** Bare scheme+host+port, or null when the value is not a parseable URL. */
export function normalizeOrigin(
  value: string | null | undefined
): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * Exact-origin match. `null` (opaque), look-alike hosts and values carrying a path or
 * different casing all normalize to something that is not the bare input, so they fail.
 */
export function isAllowedOrigin(
  origin: string | null,
  allowedOrigins: ReadonlySet<string>
): boolean {
  if (origin === null) return false
  return normalizeOrigin(origin) === origin && allowedOrigins.has(origin)
}

function toOriginSet(
  values: readonly (string | undefined)[]
): ReadonlySet<string> {
  const origins = values
    .map((value) => normalizeOrigin(value))
    .filter((origin): origin is string => origin !== null)
  return new Set(origins)
}

const APP_ORIGIN_VALUES = [
  APP_ORIGINS.CURRENT,
  APP_ORIGINS.PRODUCTION,
  APP_ORIGINS.LOCAL
]

// The apex domain serves the same app, so both hostnames are trusted for admin writes.
export const ADMIN_ALLOWED_ORIGINS = toOriginSet([
  ...APP_ORIGIN_VALUES,
  'https://tacticusanalytics.com'
])

export const TUNNEL_ALLOWED_ORIGINS = toOriginSet(APP_ORIGIN_VALUES)

import type { CookieOptions } from '@supabase/ssr'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Loopback is served over plain http, where a Secure cookie would never come back. */
export function isLoopbackOrigin(value: string | undefined): boolean {
  if (!value) return false
  let hostname: string
  try {
    hostname = new URL(value.includes('://') ? value : `https://${value}`)
      .hostname
  } catch {
    return false
  }
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost')
}

/**
 * Supabase SSR keeps session cookies browser-readable (httpOnly false) so the client can
 * refresh them; only SameSite and Secure are enforced here. `httpOnly` is left untouched.
 * Production forces Secure on; elsewhere an explicit `secure: true` is preserved, never dropped.
 */
export function hardenSessionCookieOptions(
  options: CookieOptions,
  hostOrOrigin: string | undefined
): CookieOptions {
  const secureInProduction =
    process.env.NODE_ENV === 'production' && !isLoopbackOrigin(hostOrOrigin)
  return {
    ...options,
    sameSite: 'lax',
    secure: secureInProduction || options.secure === true
  }
}

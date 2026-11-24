import type { CookieOptions } from '@supabase/ssr'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const DEFAULT_APEX_DOMAIN = 'tacticusanalytics.com'

export interface AppOriginEnv {
  NEXT_PUBLIC_APP_URL?: string
  NEXT_PUBLIC_DOMAIN?: string
}

/**
 * Apex hostname of the configured public origin: NEXT_PUBLIC_APP_URL first,
 * then NEXT_PUBLIC_DOMAIN, then the production apex. Loopback origins are
 * skipped so a desktop/dev APP_URL cannot narrow the production cookie domain.
 */
export function configuredApexDomain(
  env: AppOriginEnv = process.env as AppOriginEnv
): string {
  for (const candidate of [env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_DOMAIN]) {
    if (!candidate) continue
    try {
      const hostname = new URL(
        candidate.includes('://') ? candidate : `https://${candidate}`
      ).hostname
      if (hostname && !isLoopbackOrigin(hostname)) return hostname
    } catch {
      // Unparsable candidate: fall through to the next configured source.
    }
  }
  return DEFAULT_APEX_DOMAIN
}

/**
 * Cross-subdomain session sharing needs an explicit Domain attribute, but only
 * when the request host actually belongs to the configured apex: any other host
 * (preview deployments, LAN IPs) must keep a host-only cookie, because browsers
 * drop a Set-Cookie whose Domain is not a suffix of the request host.
 */
export function resolveSessionCookieDomain(
  hostname: string,
  env: AppOriginEnv = process.env as AppOriginEnv
): string | undefined {
  if (isLoopbackOrigin(hostname)) return undefined
  const apex = configuredApexDomain(env)
  return hostname === apex || hostname.endsWith(`.${apex}`)
    ? `.${apex}`
    : undefined
}

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

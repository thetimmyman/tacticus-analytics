/**
 * Auth proxy: caches user roles for UI navigation only; data access is still
 * enforced by API checks and RLS.
 */

import { timingSafeEqual } from 'node:crypto'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { appCache } from '@tacticus/app-core/app-cache'
import { createComponentLogger } from '@/app/lib/logging'
import { API_URLS } from '@tacticus/app-core/api-constants'
import { authConfig } from '@/app/lib/auth/config'
import {
  AUTH_RESET_COOKIE,
  AUTH_RESET_VERSION
} from '@/app/lib/auth/reset-session'
import { resolveProxySupabaseUrls } from '@/app/lib/auth/proxy-supabase-url'
import type { AppUser } from '@/app/types'
import type { CookieOptions } from '@supabase/ssr'

const logger = createComponentLogger('proxy')

// Auth-route rate limit: the proxy runs on Node with `react-server`, so app-cache's shared Redis counter
// holds across replicas. The Map is only the fail-open fallback.
const edgeRateLimits = new Map<string, { count: number; resetTime: number }>()
const AUTH_RATE_LIMIT = { max: 10, windowMs: 60 * 1000 } // 10 requests per minute per IP
const EDGE_RATE_LIMIT_KEY_PREFIX = 'ratelimit:proxy-auth'
const PROXY_TIMING = {
  AUTH_TIMEOUT: 10_000,
  ROLE_CACHE_TTL: 5 * 60 * 1000
} as const

const BLOCKED_USER_AGENTS = [
  'python-requests',
  'go-http-client',
  'curl',
  'wget',
  'postmanruntime',
  'httpie'
]

const BOT_USER_AGENTS = [
  'discordbot',
  'twitterbot',
  'facebookexternalhit',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'whatsapp',
  'applebot'
]

const OG_DOMAIN =
  process.env.NEXT_PUBLIC_DOMAIN || 'https://tacticusanalytics.com'

const OG_PROTECTED_PATHS: Record<
  string,
  { title: string; description: string }
> = {
  '/home': {
    title: 'Tacticus Analytics - Professional Guild Raid Tracker',
    description:
      'Real-time token tracking, battle analytics, and meta analysis for Warhammer 40,000: Tacticus guild raids.'
  }
}

/** Paths that require auth; the top-level catch uses it for redirect-vs-passthrough. */
const PROTECTED_PATHS = [
  '/home',
  '/dashboard',
  '/player-performance',
  '/player-stats',
  '/token-usage',
  '/boss',
  // Page-level requireAuth() gates it too; listing it makes the redirect carry `redirectTo`.
  '/replays',
  '/votlw',
  '/profile',
  '/settings',
  '/members',
  '/api-keys',
  '/guild-management'
]

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const cfIp = request.headers.get('cf-connecting-ip')
  return cfIp || forwarded?.split(',')[0]?.trim() || realIp || 'unknown'
}

/**
 * Shared edge limiter for /api/auth/*. Fails open to a per-pod Map: locking
 * everyone out of login during a Redis blip is worse than a per-pod ceiling.
 */
async function checkEdgeRateLimit(clientId: string): Promise<{
  allowed: boolean
  remaining: number
}> {
  try {
    const hit = await appCache.incrFixedWindow(
      `${EDGE_RATE_LIMIT_KEY_PREFIX}:${clientId}`,
      Math.ceil(AUTH_RATE_LIMIT.windowMs / 1000)
    )
    // null means the distributed backend errored; anything else is authoritative.
    if (hit !== null) {
      if (hit.count > AUTH_RATE_LIMIT.max) {
        return { allowed: false, remaining: 0 }
      }
      return {
        allowed: true,
        remaining: Math.max(0, AUTH_RATE_LIMIT.max - hit.count)
      }
    }
  } catch {
    // Treated like an outage: fall through to the per-pod counter.
  }
  return checkEdgeRateLimitInMemory(clientId)
}

function checkEdgeRateLimitInMemory(clientId: string): {
  allowed: boolean
  remaining: number
} {
  const now = Date.now()
  const record = edgeRateLimits.get(clientId)

  if (!record || now > record.resetTime) {
    edgeRateLimits.set(clientId, {
      count: 1,
      resetTime: now + AUTH_RATE_LIMIT.windowMs
    })
    return { allowed: true, remaining: AUTH_RATE_LIMIT.max - 1 }
  }

  if (record.count >= AUTH_RATE_LIMIT.max) {
    return { allowed: false, remaining: 0 }
  }

  record.count++
  return { allowed: true, remaining: AUTH_RATE_LIMIT.max - record.count }
}

type SessionCacheEntry = {
  user: AppUser | null
  expiry: number
}

const sessionCache = new Map<string, SessionCacheEntry>()
const MAX_CACHE_SIZE = 1000

const TOKEN_CACHE_PREFIX_LEN = 64
const TOKEN_CACHE_SUFFIX_LEN = 64

function toTokenCacheFingerprint(token: string): string {
  if (!token) return token
  if (token.length <= TOKEN_CACHE_PREFIX_LEN + TOKEN_CACHE_SUFFIX_LEN) {
    return token
  }
  return `${token.length}:${token.slice(0, TOKEN_CACHE_PREFIX_LEN)}:${token.slice(-TOKEN_CACHE_SUFFIX_LEN)}`
}

function getChunkedCookieValue(
  request: NextRequest,
  baseCookieName: string
): string | null {
  const prefix = `${baseCookieName}.`
  const chunks = request.cookies
    .getAll()
    .map(({ name, value }) => {
      if (!name.startsWith(prefix)) return null
      const suffix = name.slice(prefix.length)
      if (!/^\d+$/.test(suffix)) return null
      return { index: Number(suffix), value }
    })
    .filter(
      (entry): entry is { index: number; value: string } => entry !== null
    )
    .sort((a, b) => a.index - b.index)

  if (chunks.length === 0) {
    return null
  }

  return chunks.map((chunk) => chunk.value).join('')
}

const getSessionCacheKey = (request: NextRequest): string | null => {
  // Fingerprint the full token: prefix-only keys can collide and leak cached roles.
  const chunkedToken = getChunkedCookieValue(
    request,
    authConfig.session.storageKey
  )
  if (chunkedToken) return 'ssr-chunk:' + toTokenCacheFingerprint(chunkedToken)

  const ssrAuthToken = request.cookies.get(authConfig.session.storageKey)?.value
  if (ssrAuthToken) return 'ssr:' + toTokenCacheFingerprint(ssrAuthToken)

  const accessToken = request.cookies.get('sb-access-token')?.value
  if (accessToken) return 'access:' + toTokenCacheFingerprint(accessToken)
  const refreshToken = request.cookies.get('sb-refresh-token')?.value
  if (refreshToken) return 'refresh:' + toTokenCacheFingerprint(refreshToken)

  const authHeader = request.headers.get('authorization')
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return 'auth:' + toTokenCacheFingerprint(authHeader.slice(7))
  }
  return null
}

const hasLegacyAuthCookies = (request: NextRequest): boolean => {
  return Boolean(
    request.cookies.get('sb-access-token')?.value ||
    request.cookies.get('sb-refresh-token')?.value
  )
}

const getCachedUser = (key: string | null): AppUser | null | undefined => {
  if (!key) return undefined
  const entry = sessionCache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiry) {
    sessionCache.delete(key)
    return undefined
  }
  return entry.user
}

const setCachedUser = (key: string | null, user: AppUser | null): void => {
  if (!key) return

  if (sessionCache.size >= MAX_CACHE_SIZE) {
    const now = Date.now()
    let cleaned = 0
    for (const [cacheKey, entry] of sessionCache.entries()) {
      if (now > entry.expiry) {
        sessionCache.delete(cacheKey)
        cleaned++
      }
      if (cleaned >= 100) break
    }

    // A burst of distinct keys expires nothing within the TTL, so evict the oldest to enforce MAX_CACHE_SIZE.
    if (sessionCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = sessionCache.keys().next().value
      if (oldestKey !== undefined) {
        sessionCache.delete(oldestKey)
      }
    }
  }

  sessionCache.set(key, {
    user,
    expiry: Date.now() + PROXY_TIMING.ROLE_CACHE_TTL
  })
}

const isAbortError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'AbortError' ||
    error.message.toLowerCase().includes('aborted') ||
    error.message.includes('The operation was aborted')
  )
}

const runWithTimeout = async <T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number
): Promise<T> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await operation(controller.signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

// Static assets at the root of `public/`, outside any `public/<dir>/`.
const ROOT_STATIC_ASSETS = new Set(['/favicon.svg', '/grid.svg'])

function isFrameworkStaticPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase()
  return (
    normalized.startsWith('/_next/static/') ||
    normalized === '/_next/image' ||
    normalized.startsWith('/_next/image/') ||
    normalized === '/favicon.ico' ||
    ROOT_STATIC_ASSETS.has(normalized) ||
    // `.svg` is static only inside known asset dirs, or any route could skip the proxy by appending `.svg`.
    ((normalized.startsWith('/images/') || normalized.startsWith('/icons/')) &&
      normalized.endsWith('.svg'))
  )
}

export default async function proxy(request: NextRequest) {
  if (getRuntimeProfile() === 'desktop') {
    const expected = process.env.DESKTOP_TRANSPORT_KEY
    const supplied = request.headers.get('x-desktop-transport')
    if (
      !expected ||
      !/^[a-f0-9]{64}$/.test(expected) ||
      !supplied ||
      supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      return NextResponse.json(
        { error: 'Local transport denied' },
        { status: 403 }
      )
    }
    // Hosted credential forms must never receive a root game key in desktop mode.
    let path: string
    try {
      path = decodeURIComponent(request.nextUrl.pathname).replace(/\/+$/, '')
    } catch {
      return NextResponse.json({ error: 'Invalid local path' }, { status: 400 })
    }
    if (
      path.startsWith('/api/onboarding/') ||
      path === '/api/onboarding' ||
      path === '/api/profile/change-player-id' ||
      /^\/api\/(?:admin\/)?(?:player-api-key|validate-api-key)(?:\/|$)/.test(
        path
      ) ||
      /^\/api\/(?:guild|player|members)\/(?:test|validate|update|replace|request)-api-key(?:\/|$)/.test(
        path
      )
    ) {
      return NextResponse.json(
        {
          error: 'Use File → Game connection for native credential operations.'
        },
        { status: 409, headers: { 'cache-control': 'no-store' } }
      )
    }
    if (path === '/onboarding' || path.startsWith('/onboarding/'))
      return NextResponse.redirect(
        new URL('/desktop/connection-help', request.url)
      )
  }
  const rawPathname = request.nextUrl.pathname
  const isResetRoute = rawPathname.startsWith('/auth/reset-session')
  const isAuthCallback = rawPathname.startsWith('/auth/callback')

  if (isFrameworkStaticPath(rawPathname)) {
    return NextResponse.next()
  }

  const pathname = rawPathname
  const finalize = (response: NextResponse): NextResponse => response

  if (
    process.env.NODE_ENV === 'production' &&
    AUTH_RESET_VERSION &&
    !isResetRoute &&
    !isAuthCallback
  ) {
    const resetCookie = request.cookies.get(AUTH_RESET_COOKIE)?.value
    if (resetCookie !== AUTH_RESET_VERSION && hasLegacyAuthCookies(request)) {
      const redirectUrl = new URL('/auth/reset-session', request.url)
      const returnPath = `${pathname}${request.nextUrl.search}`
      redirectUrl.searchParams.set('next', returnPath)
      redirectUrl.searchParams.set('v', AUTH_RESET_VERSION)
      return NextResponse.redirect(redirectUrl)
    }
  }

  const ogMeta = OG_PROTECTED_PATHS[pathname]
  if (ogMeta) {
    const ua = request.headers.get('user-agent')?.toLowerCase() || ''
    if (BOT_USER_AGENTS.some((bot) => ua.includes(bot))) {
      const html = `<!DOCTYPE html>
<html><head>
<title>${ogMeta.title}</title>
<meta property="og:type" content="website" />
<meta property="og:url" content="${OG_DOMAIN}${pathname}" />
<meta property="og:title" content="${ogMeta.title}" />
<meta property="og:description" content="${ogMeta.description}" />
<meta property="og:image" content="${OG_DOMAIN}/WarpForgedDashboard.png" />
<meta property="og:image:width" content="1536" />
<meta property="og:image:height" content="1024" />
<meta property="og:site_name" content="Tacticus Analytics" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${ogMeta.title}" />
<meta name="twitter:description" content="${ogMeta.description}" />
<meta name="twitter:image" content="${OG_DOMAIN}/WarpForgedDashboard.png" />
</head><body></body></html>`
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }
  }

  if (pathname.startsWith('/api/auth/')) {
    const userAgent = request.headers.get('user-agent')?.toLowerCase() || ''
    const clientIp = getClientIp(request)

    for (const blocked of BLOCKED_USER_AGENTS) {
      if (userAgent.includes(blocked)) {
        logger.warn(
          `[Proxy] Blocked user agent on auth: ${blocked} from ${clientIp}`
        )
        return NextResponse.json({ error: 'Request blocked' }, { status: 403 })
      }
    }

    if (!userAgent || userAgent.length < 10) {
      logger.warn(`[Proxy] Blocked missing/short UA on auth from ${clientIp}`)
      return NextResponse.json({ error: 'Request blocked' }, { status: 403 })
    }

    const rateLimit = await checkEdgeRateLimit(`edge:auth:${clientIp}`)
    if (!rateLimit.allowed) {
      logger.warn(`[Proxy] Rate limit exceeded for ${clientIp} on ${pathname}`)
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  try {
    const nonce = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))
    )

    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-nonce', nonce)

    const response = NextResponse.next({
      request: { headers: requestHeaders }
    })

    const isDevelopment = process.env.NODE_ENV === 'development'
    const proxySupabaseUrls = resolveProxySupabaseUrls()
    const tacticusOrigin = new URL(API_URLS.TACTICUS.BASE).origin
    const sentryOrigin = 'https://o4510697646194688.ingest.us.sentry.io'
    const connectSrcValues = [
      "'self'",
      proxySupabaseUrls.httpSupabaseOrigin,
      proxySupabaseUrls.wsSupabaseOrigin,
      tacticusOrigin,
      sentryOrigin
    ].join(' ')

    const cspHeader = isDevelopment
      ? `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self'; connect-src ${connectSrcValues}; frame-src 'self'; frame-ancestors 'none';`
      : `default-src 'self'; script-src 'self' 'nonce-${nonce}' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self'; connect-src ${connectSrcValues}; frame-src 'self'; frame-ancestors 'none';`

    response.headers.set('Content-Security-Policy', cspHeader)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      logger.error('[Proxy] Missing required Supabase environment variables')
      if (request.nextUrl.pathname.startsWith('/auth')) {
        return response
      }
      return NextResponse.redirect(
        new URL('/auth/error?error=configuration', request.url)
      )
    }

    // In-cluster Supabase URL avoids hairpinning through the public URL; the public
    // URL still drives CSP and the storageKey, so sessions are unaffected.
    const authSupabaseUrl = proxySupabaseUrls.authSupabaseUrl

    // Cookie domain only in production (cross-subdomain auth); localhost uses the origin.
    const hostname = request.nextUrl.hostname
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
    const cookieDomain = isLocalhost ? undefined : '.tacticusanalytics.com'

    const instantiateSupabase = (signal?: AbortSignal) => {
      const cookies = {
        getAll(): { name: string; value: string }[] {
          return request.cookies.getAll()
        },
        setAll(
          cookiesToSet: {
            name: string
            value: string
            options: CookieOptions
          }[],
          headers: Record<string, string>
        ) {
          // No-store headers from @supabase/ssr: a shared cache must never keep a session cookie.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value)
          }
          for (const { name, value, options } of cookiesToSet) {
            try {
              const cookieWithDomain = {
                name,
                value,
                ...options,
                ...(cookieDomain && { domain: cookieDomain })
              }
              request.cookies.set(cookieWithDomain)
              response.cookies.set(cookieWithDomain)
            } catch (cookieError) {
              logger.error({ err: cookieError }, 'Cookie setting error')
            }
          }
        }
      }

      const supabaseOptions = {
        auth: {
          storageKey: authConfig.session.storageKey
        },
        cookies,
        ...(signal
          ? {
              global: {
                fetch: (input: RequestInfo | URL, init?: RequestInit) => {
                  const finalInit: RequestInit = {
                    ...init,
                    signal: init?.signal ?? signal
                  }
                  return fetch(input, finalInit)
                }
              }
            }
          : {})
      } satisfies Parameters<typeof createServerClient>[2]

      return createServerClient(authSupabaseUrl, supabaseKey, supabaseOptions)
    }

    const isAuthRoute = pathname.startsWith('/auth')
    const isOnboardingRoute = pathname.startsWith('/onboarding')
    const requireDiscordLink =
      process.env.NEXT_PUBLIC_REQUIRE_DISCORD_LINK === 'true' &&
      process.env.NEXT_PUBLIC_ENABLE_DISCORD_AUTH === 'true'

    const isProtectedRoute = PROTECTED_PATHS.some((path) =>
      pathname.startsWith(path)
    )

    const sessionCacheKey = getSessionCacheKey(request)
    const cachedUser = getCachedUser(sessionCacheKey)

    const maybeHandleOnboardingRedirect = (
      currentUser: AppUser | null
    ): NextResponse | null => {
      if (!currentUser) return null

      const requiresOnboarding =
        currentUser.role === 'onboarding' || !currentUser.profile

      if (requiresOnboarding && !isOnboardingRoute && !isAuthRoute) {
        return NextResponse.redirect(new URL('/onboarding', request.url))
      }

      if (!requiresOnboarding && isOnboardingRoute) {
        return NextResponse.redirect(new URL('/', request.url))
      }

      return null
    }

    if (!isProtectedRoute) {
      if (!isAuthRoute) {
        let userForOnboarding = cachedUser

        if (userForOnboarding === undefined && sessionCacheKey) {
          try {
            const fetchedUser = await runWithTimeout(
              (signal) => getCurrentUser(instantiateSupabase(signal)),
              PROXY_TIMING.AUTH_TIMEOUT
            )

            userForOnboarding = fetchedUser ?? null
            setCachedUser(sessionCacheKey, userForOnboarding ?? null)
          } catch (error) {
            logger.warn(
              { err: error },
              'Non-protected onboarding auth lookup failed'
            )
            userForOnboarding = null
          }
        }

        // Off protected routes, only bounce completed users off /onboarding; profileless users need public pages.
        if (userForOnboarding !== undefined && isOnboardingRoute) {
          const onboardingRedirect =
            maybeHandleOnboardingRedirect(userForOnboarding)
          if (onboardingRedirect) return onboardingRedirect
        }
      }

      return finalize(response)
    }

    if (isAuthRoute) {
      return finalize(response)
    }

    let user: AppUser | null = null

    if (cachedUser !== undefined) {
      user = cachedUser ?? null
    } else {
      try {
        const fetchedUser = await runWithTimeout(
          (signal) => getCurrentUser(instantiateSupabase(signal)),
          PROXY_TIMING.AUTH_TIMEOUT
        )

        user = fetchedUser ?? null
        setCachedUser(sessionCacheKey, user ?? null)
      } catch (authError) {
        const errorMessage =
          authError instanceof Error ? authError.message : 'Unknown error'

        if (
          isAbortError(authError) ||
          errorMessage.includes('fetch failed') ||
          errorMessage.includes('socket') ||
          errorMessage.includes('timeout')
        ) {
          // Availability tradeoff: if auth is briefly unreachable, pass with
          // X-Auth-Retry=true instead of redirect-looping. Safe because session-scoped
          // db() fails closed: a degraded page, not leaked data.
          logger.warn(
            { error: errorMessage },
            'Network error during auth check, allowing retry'
          )
          response.headers.set('X-Auth-Retry', 'true')
          return finalize(response)
        }

        logger.error({ err: authError }, 'Auth check failed')
        const redirectUrl = new URL('/auth/login', request.url)
        redirectUrl.searchParams.set(
          'redirectTo',
          `${pathname}${request.nextUrl.search}`
        )
        redirectUrl.searchParams.set('error', 'auth_failed')
        return NextResponse.redirect(redirectUrl)
      }
    }

    if (!user) {
      const redirectUrl = new URL('/auth/login', request.url)
      redirectUrl.searchParams.set(
        'redirectTo',
        `${pathname}${request.nextUrl.search}`
      )
      return NextResponse.redirect(redirectUrl)
    }

    const onboardingRedirect = maybeHandleOnboardingRedirect(user)
    if (onboardingRedirect) return onboardingRedirect

    if (requireDiscordLink && !pathname.startsWith('/profile')) {
      try {
        const supabaseForIdentity = instantiateSupabase()
        const {
          data: { user: authUser }
        } = await supabaseForIdentity.auth.getUser()
        const hasDiscordIdentity = Boolean(
          authUser?.identities?.some(
            (identity) => identity.provider === 'discord'
          )
        )

        if (!hasDiscordIdentity) {
          const redirectUrl = new URL('/profile', request.url)
          const returnPath = `${pathname}${request.nextUrl.search}`
          redirectUrl.searchParams.set('linkRequired', 'discord')
          redirectUrl.searchParams.set('redirectTo', returnPath)
          logger.info(
            { userId: user.id, returnPath },
            'Discord link required, redirecting user'
          )
          const redirectResponse = NextResponse.redirect(redirectUrl)
          redirectResponse.headers.set('X-Discord-Link-Required', '1')
          return redirectResponse
        }
      } catch (identityError) {
        logger.warn(
          { err: identityError },
          'Discord link check failed, allowing request'
        )
      }
    }

    // `/api-keys` is not rank-gated: any member may update their guild's key (Remove
    // is officer+ server-side), and roster sync can lag a real officer's rank.
    const officerPaths = ['/token-usage', '/settings']
    const isOfficerPath = officerPaths.some((path) => pathname.startsWith(path))

    const normalizedRole = user.role?.toLowerCase() ?? 'member'

    const isGuildManagement =
      pathname.startsWith('/guild-management') ||
      pathname.startsWith('/members')
    if (isGuildManagement) {
      const allowedGuildRoles = new Set(['officer', 'leader', 'admin'])
      if (!allowedGuildRoles.has(normalizedRole)) {
        return NextResponse.redirect(
          new URL(
            `/unauthorized?required=officer&current=${user.role}`,
            request.url
          )
        )
      }
    }

    // `/guild-api-keys` gates itself in-page and is deliberately not in PROTECTED_PATHS.
    if (isOfficerPath) {
      const officerRoles = new Set(['officer', 'leader', 'admin'])
      if (!officerRoles.has(normalizedRole)) {
        return NextResponse.redirect(
          new URL(
            `/unauthorized?required=officer&current=${user.role}`,
            request.url
          )
        )
      }
    }

    return finalize(response)
  } catch (error) {
    logger.error({ err: error }, 'Unexpected error')

    const isProtectedPath = PROTECTED_PATHS.some((path) =>
      request.nextUrl.pathname.startsWith(path)
    )

    if (!isProtectedPath) {
      return NextResponse.next()
    }

    return NextResponse.redirect(
      new URL('/auth/error?error=proxy_error', request.url)
    )
  }
}

export const config = {
  matcher: ['/:path*']
}

export const __internal = {
  sessionCache,
  setCachedUser,
  MAX_CACHE_SIZE
}

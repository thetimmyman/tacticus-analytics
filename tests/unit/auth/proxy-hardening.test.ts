import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

function dashboardRouteSegments(): string[] {
  const entries = readdirSync(resolve(process.cwd(), 'app/(dashboard)'), {
    withFileTypes: true
  })
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('_') &&
        !entry.name.startsWith('(')
    )
    .map((entry) => `/${entry.name}`)
    .sort()
}

const HOSTED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://api.tacticusanalytics.com',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_URL: 'http://supabase-kong:8000',
  NEXT_PUBLIC_RUNTIME_PROFILE: 'hosted'
}

// Only the auth-route path is exercised; the rest needs a request context.
describe('proxy edge rate-limit Map is bounded', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://api.tacticusanalytics.com'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    process.env.SUPABASE_URL = 'http://supabase-kong:8000'
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('never exceeds EDGE_RATE_LIMIT_MAX_ENTRIES across a burst of distinct IPs', async () => {
    const { __internal } = await import('@/proxy')
    const {
      edgeRateLimits,
      checkEdgeRateLimitInMemory,
      EDGE_RATE_LIMIT_MAX_ENTRIES
    } = __internal

    expect(edgeRateLimits.size).toBe(0)

    for (let i = 0; i < EDGE_RATE_LIMIT_MAX_ENTRIES + 500; i++) {
      checkEdgeRateLimitInMemory(`edge:auth:192.0.2.${i}`)
    }

    expect(edgeRateLimits.size).toBeLessThanOrEqual(EDGE_RATE_LIMIT_MAX_ENTRIES)
  })

  it('still counts a single caller inside its window', async () => {
    const { __internal } = await import('@/proxy')
    const { checkEdgeRateLimitInMemory } = __internal

    const first = checkEdgeRateLimitInMemory('edge:auth:198.51.100.1')
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(9)
  })
})

describe('proxy emits HSTS only for production HTTPS', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://api.tacticusanalytics.com')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubEnv('SUPABASE_URL', 'http://supabase-kong:8000')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sets Strict-Transport-Security on a production HTTPS response', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')
    const { default: proxy, __internal } = await import('@/proxy')

    const response = await proxy(
      new NextRequest('https://tacticusanalytics.com/auth/login')
    )

    expect(response.headers.get('Strict-Transport-Security')).toBe(
      __internal.STRICT_TRANSPORT_SECURITY
    )
    expect(__internal.STRICT_TRANSPORT_SECURITY).toContain('includeSubDomains')
  })

  it('omits HSTS outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')
    const { default: proxy } = await import('@/proxy')

    const response = await proxy(
      new NextRequest('https://tacticusanalytics.com/auth/login')
    )

    expect(response.headers.get('Strict-Transport-Security')).toBeNull()
  })

  it('omits HSTS on plain-HTTP (desktop loopback) requests', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    vi.stubEnv('DESKTOP_TRANSPORT_KEY', 'a'.repeat(64))
    const { default: proxy } = await import('@/proxy')

    const response = await proxy(
      new NextRequest('http://127.0.0.1:3000/auth/login', {
        headers: { 'x-desktop-transport': 'a'.repeat(64) }
      })
    )

    expect(response.headers.get('Strict-Transport-Security')).toBeNull()
  })
})

describe('PROTECTED_PATHS enumerates every dashboard route group', () => {
  beforeEach(() => {
    vi.resetModules()
    for (const [key, value] of Object.entries(HOSTED_ENV)) {
      vi.stubEnv(key, value)
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('protects every top-level app/(dashboard) segment on a segment boundary', async () => {
    const { __internal } = await import('@/proxy')
    const { PROTECTED_PATHS } = __internal

    expect(PROTECTED_PATHS.length).toBeGreaterThan(0)
    for (const segment of dashboardRouteSegments()) {
      const covered = PROTECTED_PATHS.some(
        (path) => path === segment || segment.startsWith(`${path}/`)
      )
      expect(covered, `${segment} must be listed in PROTECTED_PATHS`).toBe(true)
    }
  })

  it('lists each protected path exactly once', async () => {
    const { __internal } = await import('@/proxy')
    const { PROTECTED_PATHS } = __internal

    expect(new Set(PROTECTED_PATHS).size).toBe(PROTECTED_PATHS.length)
  })
})

describe('unauthenticated dashboard requests redirect to login', () => {
  const getCurrentUser = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const [key, value] of Object.entries(HOSTED_ENV)) {
      vi.stubEnv(key, value)
    }
    vi.doMock('@/app/lib/auth', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/app/lib/auth')>()
      return { ...actual, getCurrentUser }
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('redirects every dashboard segment to /auth/login with redirectTo', async () => {
    getCurrentUser.mockResolvedValue(null)
    const { default: proxy } = await import('@/proxy')

    for (const segment of dashboardRouteSegments()) {
      const response = await proxy(
        new NextRequest(`https://tacticusanalytics.com${segment}`)
      )
      expect(response.status, segment).toBe(307)
      const location = response.headers.get('location')
      expect(location, segment).toBeTruthy()
      const url = new URL(location ?? '', 'https://tacticusanalytics.com')
      expect(`${url.origin}${url.pathname}`, segment).toBe(
        'https://tacticusanalytics.com/auth/login'
      )
      expect(url.searchParams.get('redirectTo'), segment).toBe(segment)
    }
  })

  it('carries nested paths and query strings into redirectTo', async () => {
    getCurrentUser.mockResolvedValue(null)
    const { default: proxy } = await import('@/proxy')

    const response = await proxy(
      new NextRequest('https://tacticusanalytics.com/wars/lineups?season=1')
    )

    const location = response.headers.get('location')
    expect(location).toBeTruthy()
    const url = new URL(location ?? '')
    expect(url.pathname).toBe('/auth/login')
    expect(url.searchParams.get('redirectTo')).toBe('/wars/lineups?season=1')
  })

  it('admits an authenticated member through a non-officer dashboard route', async () => {
    getCurrentUser.mockResolvedValue({
      id: 'user-1',
      role: 'member',
      profile: { guild_code: 'GUILD1' }
    })
    const { default: proxy } = await import('@/proxy')

    const response = await proxy(
      new NextRequest('https://tacticusanalytics.com/wars')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('still sends members to /unauthorized on officer-gated dashboard routes', async () => {
    getCurrentUser.mockResolvedValue({
      id: 'user-1',
      role: 'member',
      profile: { guild_code: 'GUILD1' }
    })
    const { default: proxy } = await import('@/proxy')

    const response = await proxy(
      new NextRequest('https://tacticusanalytics.com/guild-management')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/unauthorized')
  })
})

describe('public routes stay publicly accessible', () => {
  const PUBLIC_PATHS = [
    '/',
    '/acknowledgements',
    '/api/version',
    '/auth/callback',
    '/auth/forgot-password',
    '/auth/login',
    '/auth/reset-session',
    '/community',
    '/creators',
    '/desktop/connection-help',
    '/do-not-sell',
    '/downloads',
    '/explore',
    '/faq',
    '/favicon.ico',
    '/_next/image?url=%2Fgrid.svg',
    '/_next/static/chunk.abc.js',
    '/monitoring',
    '/og',
    '/og-home',
    '/onboarding',
    '/privacy',
    '/privacy-rights',
    '/robots.txt',
    '/sitemap.xml',
    '/status',
    '/support-creator',
    '/terms',
    '/unauthorized'
  ]

  beforeEach(() => {
    vi.resetModules()
    for (const [key, value] of Object.entries(HOSTED_ENV)) {
      vi.stubEnv(key, value)
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('passes public, auth, api, static and monitoring routes through', async () => {
    const { default: proxy } = await import('@/proxy')

    for (const path of PUBLIC_PATHS) {
      const response = await proxy(
        new NextRequest(`https://tacticusanalytics.com${path}`)
      )
      expect(response.status, path).toBe(200)
      expect(response.headers.get('location'), path).toBeNull()
    }
  })
})

describe('session cookie domain derives from the configured apex', () => {
  beforeEach(() => {
    vi.resetModules()
    for (const [key, value] of Object.entries(HOSTED_ENV)) {
      vi.stubEnv(key, value)
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('scopes the cookie to the apex only for hosts that belong to it', async () => {
    const { resolveSessionCookieDomain } = (await import('@/proxy')).__internal

    expect(resolveSessionCookieDomain('localhost')).toBeUndefined()
    expect(resolveSessionCookieDomain('127.0.0.1')).toBeUndefined()
    expect(resolveSessionCookieDomain('tacticusanalytics.com')).toBe(
      '.tacticusanalytics.com'
    )
    expect(resolveSessionCookieDomain('www.tacticusanalytics.com')).toBe(
      '.tacticusanalytics.com'
    )
    expect(resolveSessionCookieDomain('api.tacticusanalytics.com')).toBe(
      '.tacticusanalytics.com'
    )
    expect(
      resolveSessionCookieDomain('evil-tacticusanalytics.com')
    ).toBeUndefined()
    expect(
      resolveSessionCookieDomain('preview.example.vercel.app')
    ).toBeUndefined()
  })

  it('follows NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_DOMAIN when configured', async () => {
    const { resolveSessionCookieDomain } = (await import('@/proxy')).__internal

    expect(
      resolveSessionCookieDomain('staging.app.example.com', {
        NEXT_PUBLIC_APP_URL: 'https://app.example.com'
      })
    ).toBe('.app.example.com')
    expect(
      resolveSessionCookieDomain('other.example.org', {
        NEXT_PUBLIC_APP_URL: 'https://app.example.com'
      })
    ).toBeUndefined()
    expect(
      resolveSessionCookieDomain('api.tacticusanalytics.com', {
        NEXT_PUBLIC_DOMAIN: 'https://tacticusanalytics.com'
      })
    ).toBe('.tacticusanalytics.com')
    expect(
      resolveSessionCookieDomain('lan-host.example.org', {
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000'
      })
    ).toBeUndefined()
  })
})

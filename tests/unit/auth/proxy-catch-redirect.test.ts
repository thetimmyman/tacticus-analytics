import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  resolveProxySupabaseUrls: vi.fn(() => {
    throw new Error('forced proxy failure for the negative control')
  }),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@/app/lib/auth/proxy-supabase-url', () => ({
  resolveProxySupabaseUrls: mocks.resolveProxySupabaseUrls
}))

vi.mock('@tacticus/app-core/logger', () => ({
  legacyConsoleLogger: mocks.logger
}))

// Otherwise a proxy error falls through to next() without the redirect and security headers.
const PROTECTED_PATHS = [
  '/home',
  '/dashboard',
  '/player-performance',
  '/player-stats',
  '/token-usage',
  '/boss',
  '/replays',
  '/votlw',
  '/profile',
  '/settings',
  '/members',
  '/api-keys',
  '/guild-management'
]

describe('proxy top-level catch redirects every protected path', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.resolveProxySupabaseUrls.mockImplementation(() => {
      throw new Error('forced proxy failure for the negative control')
    })

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://api.tacticusanalytics.com'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    process.env.SUPABASE_URL = 'http://supabase-kong:8000'
  })

  it.each(PROTECTED_PATHS)(
    'redirects to /auth/error instead of falling through for %s',
    async (path) => {
      const { default: proxy } = await import('@/proxy')
      const request = new NextRequest(`https://tacticusanalytics.com${path}`)

      const response = await proxy(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain(
        '/auth/error?error=proxy_error'
      )
    }
  )
})

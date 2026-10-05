// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getScriptNonceFromHeader } from 'next/dist/server/app-render/get-script-nonce-from-header'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: vi.fn() } })),
  getCurrentUser: vi.fn(async () => null),
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient
}))
vi.mock('@/app/lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser
}))
vi.mock('@tacticus/app-core/logger', () => ({
  legacyConsoleLogger: mocks.logger
}))

describe('proxy production script nonce', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon-key')
    vi.stubEnv('DESKTOP_TRANSPORT_KEY', 'a'.repeat(64))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    ['hosted', false],
    ['hosted', true],
    ['desktop', false],
    ['desktop', true]
  ] as const)(
    'forwards the emitted policy for Next scripts (%s, caller policy: %s)',
    async (profile, hasCallerPolicy) => {
      vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', profile)
      const supabaseUrl =
        profile === 'desktop'
          ? 'http://127.0.0.1:54321'
          : 'https://api.example.test'
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl)
      vi.stubEnv('SUPABASE_URL', supabaseUrl)

      const headers = new Headers({
        'x-desktop-transport': 'a'.repeat(64),
        'x-nonce': 'caller-supplied-nonce'
      })
      if (hasCallerPolicy) {
        headers.set(
          'Content-Security-Policy',
          "script-src 'unsafe-inline' 'nonce-caller-supplied-nonce'"
        )
      }
      const request = new NextRequest('https://example.test/auth/login', {
        headers
      })
      const { default: proxy } = await import('@/proxy')
      const response = await proxy(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('x-middleware-next')).toBe('1')
      // Read NextResponse's actual forwarded request headers, not the input
      // x-nonce: Next's renderer derives its nonce from the request CSP.
      const forwardedPolicy = response.headers.get(
        'x-middleware-request-content-security-policy'
      )
      expect(forwardedPolicy).toBeTruthy()
      const frameworkNonce = getScriptNonceFromHeader(forwardedPolicy!)
      expect(frameworkNonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
      expect(frameworkNonce).not.toBe('caller-supplied-nonce')
      expect(response.headers.get('x-middleware-request-x-nonce')).toBe(
        frameworkNonce
      )

      const responsePolicy = response.headers.get('Content-Security-Policy')
      expect(forwardedPolicy).toBe(responsePolicy)
      const scriptSources = responsePolicy!
        .split(';')
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith('script-src '))!
        .split(/\s+/)
        .slice(1)
      expect(scriptSources).toContain(`'nonce-${frameworkNonce}'`)
      expect(scriptSources).not.toContain("'unsafe-inline'")
      expect(scriptSources).not.toContain("'unsafe-eval'")
      expect(responsePolicy).not.toContain('caller-supplied-nonce')
      expect(
        response.headers.get('x-middleware-override-headers')?.split(',')
      ).toEqual(expect.arrayContaining(['content-security-policy', 'x-nonce']))
      expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    }
  )
})

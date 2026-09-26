import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn()
    }
  })),
  getCurrentUser: vi.fn(async () => null),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
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

describe('proxy Supabase auth URL routing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://api.tacticusanalytics.com'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    process.env.SUPABASE_URL = 'http://supabase-kong:8000'
  })

  it('uses the in-cluster Supabase URL for protected-route auth lookups', async () => {
    const { default: proxy } = await import('@/proxy')
    const request = new NextRequest('https://tacticusanalytics.com/home')

    await proxy(request)

    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1)
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      'http://supabase-kong:8000',
      'test-anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          storageKey: expect.any(String)
        }),
        cookies: expect.any(Object)
      })
    )
  })

  it('keeps the public Supabase URL fallback for local auth lookups', async () => {
    delete process.env.SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'

    const { default: proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost:3000/home')

    await proxy(request)

    expect(mocks.createServerClient).toHaveBeenCalledWith(
      'http://localhost:54321',
      'test-anon-key',
      expect.any(Object)
    )
  })

  it('keeps the main-domain auth callback available', async () => {
    const { default: proxy } = await import('@/proxy')
    const request = new NextRequest(
      'https://tacticusanalytics.com/auth/callback?code=main-domain-test'
    )

    const response = await proxy(request)

    expect(response.status).toBe(200)
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })

  it.each([
    '/api/battle/capabilities',
    '/api/%62attle/simulate',
    '/auth/callback',
    '/auth/callback?code=quarantine-test',
    '/_next/static/chunks/app.js',
    '/_next/image?url=%2Flogo.svg&w=64&q=75',
    '/favicon.ico',
    '/images/logo.svg'
  ])('runs the proxy for quarantine-sensitive path %s', async (path) => {
    const { config } = await import('@/proxy')

    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: `https://simulator.tacticusanalytics.com${path}`
      })
    ).toBe(true)
  })

  it.each([
    '/_next/static/chunks/app.js',
    '/_next/image?url=%2Flogo.svg&w=64&q=75',
    '/favicon.ico',
    '/images/logo.svg'
  ])(
    'keeps main-domain framework/static path %s on the fast path',
    async (path) => {
      const { default: proxy } = await import('@/proxy')
      const request = new NextRequest(`https://tacticusanalytics.com${path}`)

      const response = await proxy(request)

      expect(response.status).toBe(200)
      expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    }
  )
})

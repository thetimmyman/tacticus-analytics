import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

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

import { describe, expect, it } from 'vitest'
import { resolveProxySupabaseUrls } from '@/app/lib/auth/proxy-supabase-url'

describe('resolveProxySupabaseUrls', () => {
  it('uses the internal Supabase URL for server-side auth while preserving public browser origins', () => {
    const urls = resolveProxySupabaseUrls({
      NEXT_PUBLIC_SUPABASE_URL: 'https://api.tacticusanalytics.com',
      SUPABASE_URL: 'http://supabase-kong:8000'
    })

    expect(urls.authSupabaseUrl).toBe('http://supabase-kong:8000')
    expect(urls.publicSupabaseUrl).toBe('https://api.tacticusanalytics.com')
    expect(urls.httpSupabaseOrigin).toBe('https://api.tacticusanalytics.com')
    expect(urls.wsSupabaseOrigin).toBe('wss://api.tacticusanalytics.com')
  })

  it('falls back to the public URL for local development when no internal URL is set', () => {
    const urls = resolveProxySupabaseUrls({
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321'
    })

    expect(urls.authSupabaseUrl).toBe('http://localhost:54321')
    expect(urls.httpSupabaseOrigin).toBe('http://localhost:54321')
    expect(urls.wsSupabaseOrigin).toBe('ws://localhost:54321')
  })

  it('keeps browser-facing CSP origins public even when auth uses an in-cluster URL', () => {
    const urls = resolveProxySupabaseUrls({
      NEXT_PUBLIC_SUPABASE_URL: 'https://api.tacticusanalytics.com',
      SUPABASE_URL: 'http://supabase-kong:8000'
    })

    expect(urls.httpSupabaseOrigin).not.toBe(urls.authSupabaseUrl)
    expect(urls.wsSupabaseOrigin).not.toContain('supabase-kong')
  })

  it('uses the production public URL fallback for CSP when public env is absent', () => {
    const urls = resolveProxySupabaseUrls({})

    expect(urls.publicSupabaseUrl).toBe('https://api.tacticusanalytics.com')
    expect(urls.authSupabaseUrl).toBe('https://api.tacticusanalytics.com')
    expect(urls.httpSupabaseOrigin).toBe('https://api.tacticusanalytics.com')
    expect(urls.wsSupabaseOrigin).toBe('wss://api.tacticusanalytics.com')
  })

  it('falls back to safe browser origins when the public env is malformed', () => {
    const urls = resolveProxySupabaseUrls({
      NEXT_PUBLIC_SUPABASE_URL: 'not a url',
      SUPABASE_URL: 'http://supabase-kong:8000'
    })

    expect(urls.authSupabaseUrl).toBe('http://supabase-kong:8000')
    expect(urls.httpSupabaseOrigin).toBe('https://api.tacticusanalytics.com')
    expect(urls.wsSupabaseOrigin).toBe('wss://api.tacticusanalytics.com')
  })
})

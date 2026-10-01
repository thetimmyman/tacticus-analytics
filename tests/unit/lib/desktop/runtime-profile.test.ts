import { describe, expect, it } from 'vitest'
import {
  getRuntimeProfile,
  requireDesktopServiceUrl
} from '@tacticus/app-core/runtime-profile'
import { resolveProxySupabaseUrls } from '@/app/lib/auth/proxy-supabase-url'

describe('runtime endpoint authority', () => {
  it('retains hosted defaults', () => {
    expect(getRuntimeProfile({})).toBe('hosted')
    expect(resolveProxySupabaseUrls({}).publicSupabaseUrl).toBe(
      'https://api.tacticusanalytics.com'
    )
  })
  it('rejects an unknown profile', () => {
    expect(() =>
      getRuntimeProfile({ NEXT_PUBLIC_RUNTIME_PROFILE: 'desktpo' })
    ).toThrow()
  })
  it.each([
    undefined,
    '',
    'https://api.tacticusanalytics.com',
    'http://localhost:1234',
    'http://127.0.0.1',
    'http://127.0.0.1:1234@remote.invalid',
    'http://127.0.0.1:1234/?remote=true'
  ])('rejects an unsafe local endpoint: %s', (value) => {
    expect(() => requireDesktopServiceUrl(value)).toThrow()
  })
  it('requires both desktop endpoints instead of inheriting a hosted default', () => {
    expect(() =>
      resolveProxySupabaseUrls({ NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop' })
    ).toThrow()
    expect(() =>
      resolveProxySupabaseUrls({
        NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1234/supabase'
      })
    ).toThrow()
  })
  it('resolves explicit local HTTP and WebSocket origins', () => {
    expect(
      resolveProxySupabaseUrls({
        NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1234/supabase',
        SUPABASE_URL: 'http://127.0.0.1:1234/supabase'
      })
    ).toEqual({
      publicSupabaseUrl: 'http://127.0.0.1:1234/supabase',
      authSupabaseUrl: 'http://127.0.0.1:1234/supabase',
      httpSupabaseOrigin: 'http://127.0.0.1:1234',
      wsSupabaseOrigin: 'ws://127.0.0.1:1234'
    })
  })
})

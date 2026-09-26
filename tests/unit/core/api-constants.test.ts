import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ENV_KEYS = ['NEXT_PUBLIC_TACTICUS_API_URL']
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
)

const restoreEnv = () => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  })
}

const loadApiConstants = async (options?: {
  hasCredentials?: boolean
  host?: string
  ws?: string
}) => {
  const resolved = {
    hasCredentials: options?.hasCredentials ?? false,
    host: options?.host ?? 'placeholder.supabase.co',
    ws: options?.ws ?? 'wss://placeholder.supabase.co'
  }

  vi.resetModules()
  vi.doMock('@tacticus/app-core/supabase-env', () => ({
    hasSupabaseCredentials: () => resolved.hasCredentials,
    getSupabaseHost: () => resolved.host,
    getSupabaseWsUrl: () => resolved.ws
  }))

  return await import('@tacticus/app-core/api-constants')
}

describe('api-constants', () => {
  beforeEach(() => {
    restoreEnv()
  })

  afterEach(() => {
    restoreEnv()
    vi.restoreAllMocks()
  })

  it('uses placeholder supabase values and default tacticus base when env missing', async () => {
    delete process.env.NEXT_PUBLIC_TACTICUS_API_URL

    const mod = await loadApiConstants({ hasCredentials: false })

    expect(mod.API_URLS.SUPABASE.URL_PATTERN).toBe(
      'https://placeholder.supabase.co'
    )
    expect(mod.API_URLS.SUPABASE.WS_PATTERN).toBe(
      'wss://placeholder.supabase.co'
    )
    expect(mod.API_URLS.TACTICUS.BASE).toBe(
      'https://api.tacticusgame.com/api/v1'
    )
    expect(mod.DB_TABLES.BATTLE_DATA).toBe('EOT_GR_data')
  })

  it('uses env overrides and supplied supabase host when credentials exist', async () => {
    process.env.NEXT_PUBLIC_TACTICUS_API_URL = 'https://api.example.com/v2'

    const mod = await loadApiConstants({
      hasCredentials: true,
      host: 'example.supabase.co',
      ws: 'wss://example.supabase.co'
    })

    expect(mod.API_URLS.TACTICUS.BASE).toBe('https://api.example.com/v2')
    expect(mod.API_URLS.SUPABASE.URL_PATTERN).toBe(
      'https://example.supabase.co'
    )
    expect(mod.API_URLS.SUPABASE.WS_PATTERN).toBe('wss://example.supabase.co')
    expect(mod.CSP_DOMAINS.CONNECT_SRC).toContain('https://example.supabase.co')
    expect(mod.CSP_DOMAINS.CONNECT_SRC).toContain('wss://example.supabase.co')
    expect(mod.CSP_DOMAINS.CONNECT_SRC).toContain('https://api.example.com/v2')
  })
})

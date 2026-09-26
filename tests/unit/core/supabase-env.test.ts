import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'Supabase_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'Supabase_Service_Role_Key',
  'Secret_key',
  'Supabase_Anon_Key'
]

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

const loadModule = async () => {
  vi.resetModules()
  return await import('@tacticus/app-core/supabase-env')
}

describe('supabase-env', () => {
  beforeEach(() => {
    restoreEnv()
  })

  afterEach(() => {
    restoreEnv()
  })

  it('falls back to placeholder values when env is missing', async () => {
    ENV_KEYS.forEach((key) => delete process.env[key])

    const mod = await loadModule()

    expect(mod.SUPABASE_URL).toBe('https://placeholder.supabase.co')
    expect(mod.SUPABASE_HOST).toBe('placeholder.supabase.co')
    expect(mod.SUPABASE_WS_URL).toBe('wss://placeholder.supabase.co')
    expect(mod.HAS_SUPABASE_CONFIG).toBe(false)
    expect(mod.getSupabaseProjectRef()).toBe('placeholder')
  })

  it('derives host and project ref from a valid URL', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

    const mod = await loadModule()

    expect(mod.getSupabaseUrl()).toBe('https://example.supabase.co')
    expect(mod.getSupabaseHost()).toBe('example.supabase.co')
    expect(mod.getSupabaseWsUrl()).toBe('wss://example.supabase.co')
    expect(mod.getSupabaseProjectRef()).toBe('example')
    expect(mod.HAS_SUPABASE_CONFIG).toBe(true)
    expect(mod.getSupabaseAnonKey()).toBe('anon-key')
    expect(mod.getSupabaseServiceRoleKey()).toBe('service-key')
  })

  it('uses fallback host when the URL is invalid', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'not-a-url'

    const mod = await loadModule()

    expect(mod.SUPABASE_URL).toBe('not-a-url')
    expect(mod.SUPABASE_HOST).toBe('placeholder.supabase.co')
    expect(mod.getSupabaseProjectRef()).toBe('placeholder')
    expect(mod.HAS_SUPABASE_CONFIG).toBe(true)
  })
})

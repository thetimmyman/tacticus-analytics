import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { serverEnv } from '@tacticus/app-core/server-env'

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DISCORD_DEV_WEBHOOK_URL'
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

describe('serverEnv', () => {
  beforeEach(() => {
    restoreEnv()
  })

  afterEach(() => {
    restoreEnv()
  })

  it('throws when required env values are missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    expect(() => serverEnv.NEXT_PUBLIC_SUPABASE_URL).toThrow(
      'Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL'
    )
  })

  it('returns required env values when configured', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'

    expect(serverEnv.NEXT_PUBLIC_SUPABASE_URL).toBe(
      'https://example.supabase.co'
    )
    expect(serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon')
    expect(serverEnv.SUPABASE_SERVICE_ROLE_KEY).toBe('service')
  })

  it('returns an empty string for optional env values', () => {
    delete process.env.DISCORD_DEV_WEBHOOK_URL
    expect(serverEnv.DISCORD_DEV_WEBHOOK_URL).toBe('')
  })
})

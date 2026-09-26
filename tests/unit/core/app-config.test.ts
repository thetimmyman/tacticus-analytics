import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ENV_KEYS = [
  'NEXT_PUBLIC_SITE_URL',
  'RESEND_FROM_EMAIL',
  'DISCORD_VERSION_WEBHOOK_ID',
  'DISCORD_DEV_WEBHOOK_ID',
  'DISCORD_GUILD_WEBHOOK_ID'
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

const baseApiUrls = {
  APP: { BASE_URL: 'https://www.tacticusanalytics.com' },
  DISCORD: { WEBHOOK_BASE: 'https://discord.com/api/webhooks/' },
  TACTICUS: { BASE: 'https://api.tacticusgame.com/api/v1' }
}

const loadAppConfig = async (apiUrls = baseApiUrls) => {
  vi.resetModules()
  vi.doMock('@tacticus/app-core/api-constants', () => ({
    API_URLS: apiUrls
  }))

  return await import('@tacticus/app-core/app-config')
}

describe('app-config', () => {
  beforeEach(() => {
    restoreEnv()
  })

  afterEach(() => {
    restoreEnv()
    vi.restoreAllMocks()
  })

  it('uses defaults when env is missing', async () => {
    ENV_KEYS.forEach((key) => delete process.env[key])

    const mod = await loadAppConfig()

    expect(mod.APP_ORIGINS.CURRENT).toBe(baseApiUrls.APP.BASE_URL)
    expect(mod.APP_ORIGINS.PRODUCTION).toBe(baseApiUrls.APP.BASE_URL)
    expect(mod.APP_ORIGINS.LOCAL).toBe('http://localhost:3000')
    expect(mod.EMAIL_ADDRESSES.DEFAULT_FROM).toBe(
      'Tacticus Analytics <support@tacticusanalytics.com>'
    )
    expect(mod.DISCORD_CONSTANTS.WEBHOOK_BASE).toBe(
      baseApiUrls.DISCORD.WEBHOOK_BASE
    )
    // Built-in defaults are snowflake-shaped IDs; the exact values live in app-config.
    const snowflake = /^\d{17,20}$/
    expect(mod.DISCORD_CONSTANTS.WEBHOOK_IDS.VERSION_UPDATE).toMatch(snowflake)
    expect(mod.DISCORD_CONSTANTS.WEBHOOK_IDS.DEV).toMatch(snowflake)
    expect(mod.DISCORD_CONSTANTS.WEBHOOK_IDS.DEV).not.toBe(
      mod.DISCORD_CONSTANTS.WEBHOOK_IDS.VERSION_UPDATE
    )
    expect(mod.DISCORD_CONSTANTS.WEBHOOK_IDS.GUILD_UPDATES).toBe('')
  })

  it('uses env overrides and trims site URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = ' https://custom.example.com '
    process.env.RESEND_FROM_EMAIL = 'Custom <custom@example.com>'
    process.env.DISCORD_VERSION_WEBHOOK_ID = 'version'
    process.env.DISCORD_DEV_WEBHOOK_ID = 'dev'
    process.env.DISCORD_GUILD_WEBHOOK_ID = 'guild'

    const mod = await loadAppConfig()

    expect(mod.APP_ORIGINS.CURRENT).toBe('https://custom.example.com')
    expect(mod.EMAIL_ADDRESSES.DEFAULT_FROM).toBe('Custom <custom@example.com>')
    expect(mod.DISCORD_CONSTANTS.WEBHOOK_IDS).toEqual({
      VERSION_UPDATE: 'version',
      DEV: 'dev',
      GUILD_UPDATES: 'guild'
    })
  })

  it('falls back to default tacticus origin when base is invalid', async () => {
    const mod = await loadAppConfig({
      ...baseApiUrls,
      TACTICUS: { BASE: 'not-a-url' }
    })

    expect(mod.TACTICUS_API.BASE_URL).toBe('not-a-url')
    expect(mod.TACTICUS_API.ORIGIN).toBe('https://api.tacticusgame.com')
  })
})

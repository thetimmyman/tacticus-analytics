import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Feature Flags', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('featureFlags object', () => {
    it('guildWar is disabled', async () => {
      const { featureFlags } = await import('@/app/lib/utils/feature-flags')
      expect(featureFlags.guildWar).toBe(false)
    })

    it('discordAuth reflects environment variable', async () => {
      process.env.NEXT_PUBLIC_ENABLE_DISCORD_AUTH = 'true'
      vi.resetModules()

      const { featureFlags } = await import('@/app/lib/utils/feature-flags')
      expect(featureFlags.discordAuth).toBe(true)
    })

    it('discordAuth is false when env var is not set', async () => {
      delete process.env.NEXT_PUBLIC_ENABLE_DISCORD_AUTH
      vi.resetModules()

      const { featureFlags } = await import('@/app/lib/utils/feature-flags')
      expect(featureFlags.discordAuth).toBe(false)
    })

    it('googleAuth reflects environment variable', async () => {
      process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH = 'true'
      vi.resetModules()

      const { featureFlags } = await import('@/app/lib/utils/feature-flags')
      expect(featureFlags.googleAuth).toBe(true)
    })

    it('requireDiscordLink reflects environment variable', async () => {
      process.env.NEXT_PUBLIC_REQUIRE_DISCORD_LINK = 'true'
      vi.resetModules()

      const { featureFlags } = await import('@/app/lib/utils/feature-flags')
      expect(featureFlags.requireDiscordLink).toBe(true)
    })
  })

  describe('isFeatureEnabled', () => {
    it('returns false for disabled features', async () => {
      const { isFeatureEnabled } = await import('@/app/lib/utils/feature-flags')
      expect(isFeatureEnabled('guildWar')).toBe(false)
    })

    it('returns correct value for env-based features', async () => {
      process.env.NEXT_PUBLIC_ENABLE_DISCORD_AUTH = 'true'
      vi.resetModules()

      const { isFeatureEnabled } = await import('@/app/lib/utils/feature-flags')
      expect(isFeatureEnabled('discordAuth')).toBe(true)
    })
  })

  describe('useFeatureFlag', () => {
    it('returns false for disabled features', async () => {
      const { useFeatureFlag } = await import('@/app/lib/utils/feature-flags')
      expect(useFeatureFlag('guildWar')).toBe(false)
    })

    it('is equivalent to isFeatureEnabled', async () => {
      const { isFeatureEnabled, useFeatureFlag } =
        await import('@/app/lib/utils/feature-flags')

      expect(useFeatureFlag('guildWar')).toBe(isFeatureEnabled('guildWar'))
      expect(useFeatureFlag('discordAuth')).toBe(
        isFeatureEnabled('discordAuth')
      )
    })
  })
})

'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/app/lib/auth'
import { appCache } from '@tacticus/app-core/app-cache'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('guild-management.settings.actions')
import {
  fetchGuildSettings,
  updateApiKeyValidationState,
  updateGuildSettings,
  type GuildSettingsRecord,
  type UpdateGuildSettingsInput
} from '@/app/lib/services/guild-settings-service'
import {
  DEFAULT_OBFUSCATION_PERCENT,
  normalizeObfuscationPercent
} from '@tacticus/app-core/privacy'

const SETTINGS_PATH = '/guild-management/settings'

type SaveGuildSettingsResult =
  | { success: true; data: GuildSettingsRecord }
  | { success: false; error: string }

type MarkApiKeyValidatedResult =
  | { success: true; validatedAt: string; validatedBy: string | null }
  | { success: false; error: string }

function normalizeField(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function refreshExploreCacheForGuild(
  guildCode: string,
  triggeredBy: string
): Promise<void> {
  try {
    const cacheKeysToInvalidate = [
      `explore:guild:${guildCode}`,
      `explore:guild:${guildCode}:hits`,
      `explore:guild:${guildCode}:ranking`,
      `explore:guild:${guildCode}:performance`,
      `explore:guild:${guildCode}:members`,
      `explore:guild:${guildCode}:votlw`,

      `explore:guild:${guildCode}:public`,
      `explore:guild:${guildCode}:filtered`,

      `guild:${guildCode}:public_info`,
      `guild:${guildCode}:explore_data`,
      `guild:${guildCode}:privacy_settings`,

      'explore:top_guilds',
      'explore:leaderboard',
      'explore:recent_hits',
      'explore:guild_rankings',
      'explore:boss_leaderboards',

      `boss_hits:${guildCode}`,
      `boss_rankings:${guildCode}`,
      `damage_leaderboard:${guildCode}`,

      `members:${guildCode}:performance`,
      `players:${guildCode}:explore`
    ]

    let clearedKeys = 0
    for (const key of cacheKeysToInvalidate) {
      try {
        await appCache.del(key)
        clearedKeys++
      } catch (error) {
        logger.warn(
          {
            key,
            guildCode,
            error: error instanceof Error ? error.message : 'Unknown error'
          },
          'Failed to clear cache key during auto-refresh'
        )
      }
    }

    logger.info(
      {
        guildCode,
        clearedKeys,
        totalAttempted: cacheKeysToInvalidate.length,
        triggeredBy
      },
      'Auto-refreshed explore cache after privacy settings change'
    )
  } catch (error) {
    logger.error(
      {
        guildCode,
        triggeredBy,
        error
      },
      'Failed to auto-refresh explore cache'
    )
    // Cache refresh failures must not break the settings save.
  }
}

export async function saveGuildSettingsAction(
  input: UpdateGuildSettingsInput
): Promise<SaveGuildSettingsResult> {
  try {
    const { profile } = await requireRole('officer')

    if (
      !profile.guild_code ||
      profile.guild_code.toUpperCase() !== input.guildCode.toUpperCase()
    ) {
      throw new Error('You can only update settings for your guild')
    }

    const currentConfig = await fetchGuildSettings(input.guildCode)
    const currentPrivacyMode = currentConfig.explore_privacy_mode
    const newPrivacyMode = input.explorePrivacyMode
    const currentObfuscationPercent = normalizeObfuscationPercent(
      currentConfig.explore_obfuscation_percent ?? DEFAULT_OBFUSCATION_PERCENT
    )
    const newObfuscationPercent = normalizeObfuscationPercent(
      input.exploreObfuscationPercent
    )

    const privacyModesChanged =
      JSON.stringify(currentPrivacyMode?.sort()) !==
      JSON.stringify(newPrivacyMode?.sort())
    const obfuscationChanged =
      currentObfuscationPercent !== newObfuscationPercent
    const privacyChanged = privacyModesChanged || obfuscationChanged

    await updateGuildSettings({
      ...input,
      // Attribute guild_config changes to the acting user for audit_logs.
      actingUserId: profile.user_id ?? null,
      tagline: normalizeField(input.tagline),
      description: normalizeField(input.description),
      logoUrl: normalizeField(input.logoUrl),
      socialLinks: {
        discord: normalizeField(input.socialLinks.discord),
        website: normalizeField(input.socialLinks.website),
        twitter: normalizeField(input.socialLinks.twitter)
      }
    })

    const updatedConfig = await fetchGuildSettings(input.guildCode)

    if (privacyChanged) {
      logger.info(
        {
          guildCode: input.guildCode,
          oldPrivacyMode: currentPrivacyMode,
          newPrivacyMode: newPrivacyMode,
          triggeredBy: profile.display_name
        },
        'Privacy settings changed, auto-refreshing explore cache'
      )

      refreshExploreCacheForGuild(
        input.guildCode,
        profile.display_name || 'Unknown user'
      ).catch((error) => {
        logger.error(
          {
            guildCode: input.guildCode,
            error
          },
          'Background explore cache refresh failed'
        )
      })
    }

    revalidatePath(SETTINGS_PATH)

    return { success: true, data: updatedConfig }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to save guild settings right now'
    return { success: false, error: message }
  }
}

export async function markApiKeyValidatedAction(
  guildCode: string
): Promise<MarkApiKeyValidatedResult> {
  try {
    const { profile } = await requireRole('leader')

    if (
      !profile.guild_code ||
      guildCode.toUpperCase() !== profile.guild_code.toUpperCase()
    ) {
      throw new Error('Access denied for requested guild')
    }

    const validatedAt = new Date().toISOString()
    const validatedBy = profile.display_name ?? profile.user_id ?? null

    await updateApiKeyValidationState({
      guildCode,
      validatedAt,
      isValid: true,
      validatedBy
    })

    revalidatePath(SETTINGS_PATH)

    return { success: true, validatedAt, validatedBy }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to update API key validation state'
    return { success: false, error: message }
  }
}

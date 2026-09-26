import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.explore.refresh-cache')
import { appCache } from '@tacticus/app-core/app-cache'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const { profile } = await requireRoleForApi('officer')

    const body = await request.json()
    const { guild_code } = body

    if (!guild_code) {
      throw Errors.fromResponse(400, { error: 'Guild code is required' })
    }

    if (profile.guild_code !== guild_code) {
      throw Errors.fromResponse(403, {
        error: 'Insufficient permissions for this guild'
      })
    }

    logger.info(
      {
        guildCode: guild_code,
        triggeredBy: profile.display_name
      },
      'Refreshing explore cache'
    )

    const cacheKeysToInvalidate = [
      `explore:guild:${guild_code}`,
      `explore:guild:${guild_code}:hits`,
      `explore:guild:${guild_code}:ranking`,
      `explore:guild:${guild_code}:performance`,
      `explore:guild:${guild_code}:members`,
      `explore:guild:${guild_code}:votlw`,

      `explore:guild:${guild_code}:public`,
      `explore:guild:${guild_code}:filtered`,

      `guild:${guild_code}:public_info`,
      `guild:${guild_code}:explore_data`,
      `guild:${guild_code}:privacy_settings`,

      'explore:top_guilds',
      'explore:leaderboard',
      'explore:recent_hits',
      'explore:guild_rankings',
      'explore:boss_leaderboards',

      `boss_hits:${guild_code}`,
      `boss_rankings:${guild_code}`,
      `damage_leaderboard:${guild_code}`,

      `members:${guild_code}:performance`,
      `players:${guild_code}:explore`
    ]

    let clearedKeys = 0
    let failedKeys = 0

    for (const key of cacheKeysToInvalidate) {
      try {
        await appCache.del(key)
        clearedKeys++
        logger.debug({ key, guildCode: guild_code }, 'Cleared cache key')
      } catch (error) {
        rethrowIfAppError(error)
        failedKeys++
        logger.warn(
          {
            key,
            guildCode: guild_code,
            error: error instanceof Error ? error.message : 'Unknown error'
          },
          'Failed to clear cache key'
        )
      }
    }

    // Pattern-matched keys are not cleared.

    logger.info(
      {
        guildCode: guild_code,
        clearedKeys,
        failedKeys,
        totalAttempted: cacheKeysToInvalidate.length,
        triggeredBy: profile.display_name
      },
      'Explore cache invalidation completed'
    )

    logger.info(
      {
        guildCode: guild_code,
        triggeredBy: profile.display_name
      },
      'Explore cache refreshed successfully'
    )

    return NextResponse.json({
      success: true,
      message: 'Public data cache refreshed',
      timestamp: new Date().toISOString(),
      cache_stats: {
        cleared_keys: clearedKeys,
        failed_keys: failedKeys,
        total_attempted: cacheKeysToInvalidate.length
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ error }, 'Failed to refresh explore cache')

    throw Errors.fromResponse(500, {
      error: 'Failed to refresh public data cache'
    })
  }
})

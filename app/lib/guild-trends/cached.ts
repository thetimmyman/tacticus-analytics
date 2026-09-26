import 'server-only'

import { appCache } from '@tacticus/app-core/app-cache'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  getGuildTrendsBatchRPC,
  type GuildTrendsRow
} from '@/app/lib/calculations/experimental/guild-trends'
import {
  getGuildVsClusterBossPerformanceRPC,
  type GuildVsClusterBossRow
} from '@/app/lib/calculations/experimental/guild-vs-cluster'
import { createComponentLogger } from '@/app/lib/logging'
import {
  CLOSED_SEASON_TTL_SECONDS,
  CURRENT_SEASON_TTL_SECONDS
} from '@/app/lib/season-date/ttl'

const logger = createComponentLogger('lib.guild-trends.cached')

const TRENDS_KEY_PREFIX = 'gtrends:season'
const RADAR_KEY_PREFIX = 'gtrends:radar'

function trendsKey(guildCode: string, season: string): string {
  return `${TRENDS_KEY_PREFIX}:${guildCode}:${season}`
}

function radarKey(guildCode: string, season: string): string {
  return `${RADAR_KEY_PREFIX}:${guildCode}:${season}`
}

function ttlForSeason(season: string, latestSeason: string): number {
  return season === latestSeason
    ? CURRENT_SEASON_TTL_SECONDS
    : CLOSED_SEASON_TTL_SECONDS
}

/** Falls back to a direct RPC if the cache fails, so Redis can't break the page. */
export async function getGuildTrendsCached(
  supabase: TypedSupabaseClient,
  guildCode: string,
  seasons: string[],
  latestSeason: string
): Promise<GuildTrendsRow[]> {
  if (!guildCode || seasons.length === 0) return []

  const cached = new Map<string, GuildTrendsRow>()
  const missing: string[] = []

  await Promise.all(
    seasons.map(async (season) => {
      try {
        const hit = await appCache.get<GuildTrendsRow>(
          trendsKey(guildCode, season)
        )
        if (hit) {
          cached.set(season, hit)
          return
        }
      } catch (err) {
        logger.warn(
          { guildCode, season, err: err instanceof Error ? err.message : err },
          'cache get failed; treating as miss'
        )
      }
      missing.push(season)
    })
  )

  if (missing.length > 0) {
    const fresh = await getGuildTrendsBatchRPC(supabase, {
      guild_code: guildCode,
      seasons: missing
    })
    await Promise.all(
      fresh.map(async (row) => {
        cached.set(row.season, row)
        try {
          await appCache.set(
            trendsKey(guildCode, row.season),
            row,
            ttlForSeason(row.season, latestSeason)
          )
        } catch (err) {
          logger.warn(
            {
              guildCode,
              season: row.season,
              err: err instanceof Error ? err.message : err
            },
            'cache set failed; row served uncached'
          )
        }
      })
    )
  }

  return seasons
    .map((s) => cached.get(s))
    .filter((row): row is GuildTrendsRow => row !== undefined)
}

export async function getGuildVsClusterBossCached(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string,
  latestSeason: string
): Promise<GuildVsClusterBossRow[]> {
  if (!guildCode || !season) return []

  try {
    const hit = await appCache.get<GuildVsClusterBossRow[]>(
      radarKey(guildCode, season)
    )
    if (hit) return hit
  } catch (err) {
    logger.warn(
      { guildCode, season, err: err instanceof Error ? err.message : err },
      'radar cache get failed; treating as miss'
    )
  }

  const fresh = await getGuildVsClusterBossPerformanceRPC(supabase, {
    Guild: guildCode,
    Season: season
  })

  try {
    await appCache.set(
      radarKey(guildCode, season),
      fresh,
      ttlForSeason(season, latestSeason)
    )
  } catch (err) {
    logger.warn(
      { guildCode, season, err: err instanceof Error ? err.message : err },
      'radar cache set failed; rows served uncached'
    )
  }

  return fresh
}

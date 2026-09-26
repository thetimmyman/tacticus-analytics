/** Separate module because route modules may only export handlers. */

import { appCache } from '@tacticus/app-core/app-cache'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('season-config-cache')

/** Short because invalidation only covers the planner table. */
export const SEASON_CONFIG_TTL_SECONDS = 60

/** '' collapses to `none`, as on the read path. */
export const seasonConfigCacheKey = (
  guildCode: string,
  bossType: string,
  raritySet: string,
  season: string
): string =>
  `season_config:${guildCode}:${bossType}:${raritySet}:${season.length > 0 ? season : 'none'}`

interface SeasonConfigCacheSupabaseLike {
  from(table: string): unknown
}

interface BossTypeSelect {
  select(columns: string): Promise<{
    data: Array<{ boss_type?: unknown }> | null
    error: { message?: string } | null
  }>
}

/** Same universe the aggregator and target-token write use, so no live key is missed. */
const loadBossTypes = async (supabase: unknown): Promise<string[]> => {
  const client = supabase as SeasonConfigCacheSupabaseLike
  const table = client.from('boss_mapping') as BossTypeSelect
  const { data, error } = (await table.select('boss_type')) ?? {
    data: null,
    error: null
  }
  if (error) {
    logger.warn(
      { err: error.message },
      'season_config.cache.boss_types_lookup_failed'
    )
    return []
  }
  const seen = new Set<string>()
  for (const row of data ?? []) {
    const bossType = row?.boss_type
    if (typeof bossType === 'string' && bossType.length > 0) {
      seen.add(bossType)
    }
  }
  return Array.from(seen)
}

/** The key includes bossType, so bust every bossType (appCache has exact-key `del` only). Fails open. */
export async function invalidateSeasonConfigCache(
  supabase: unknown,
  params: { guildCode: string; raritySet: string; season: string }
): Promise<void> {
  try {
    const bossTypes = await loadBossTypes(supabase)
    if (bossTypes.length === 0) return
    await Promise.all(
      bossTypes.map((bossType) =>
        appCache.del(
          seasonConfigCacheKey(
            params.guildCode,
            bossType,
            params.raritySet,
            params.season
          )
        )
      )
    )
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        guild_code: params.guildCode,
        rarity_set: params.raritySet,
        season: params.season
      },
      'season_config.cache.invalidation_failed'
    )
  }
}

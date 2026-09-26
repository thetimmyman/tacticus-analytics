// @deno-types="npm:@supabase/supabase-js@2.39.0"
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Near-static reference data (changes only on game-data ingestion); a pod restart forces a refresh.
const REFERENCE_DATA_TTL_MS = 15 * 60 * 1000

interface CacheEntry<T> {
  value: T | null
  fetchedAt: number
  inflight: Promise<T> | null
}

const heroEmojiCache: CacheEntry<Map<string, string>> = {
  value: null,
  fetchedAt: 0,
  inflight: null
}

const bossMapCache: CacheEntry<Map<string, Record<string, unknown>>> = {
  value: null,
  fetchedAt: 0,
  inflight: null
}

async function fetchHeroEmojiMap(
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  const { data: heroMappings, error } = await supabase
    .from('hero_mappings')
    .select('unit_id, display_name, discord_emoji')
  if (error) {
    throw new Error(`loadHeroEmojiMap: ${error.message ?? 'fetch failed'}`)
  }
  if (!heroMappings || heroMappings.length === 0) {
    throw new Error('loadHeroEmojiMap: empty result from hero_mappings')
  }
  const emojiMap = new Map<string, string>()
  for (const hero of heroMappings) {
    if (hero.discord_emoji) {
      if (hero.unit_id) emojiMap.set(hero.unit_id, hero.discord_emoji)
      if (hero.display_name) emojiMap.set(hero.display_name, hero.discord_emoji)
    }
  }
  return emojiMap
}

export async function loadHeroEmojiMap(
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  const now = Date.now()
  if (
    heroEmojiCache.value &&
    now - heroEmojiCache.fetchedAt < REFERENCE_DATA_TTL_MS
  ) {
    return heroEmojiCache.value
  }
  if (heroEmojiCache.inflight) return heroEmojiCache.inflight

  heroEmojiCache.inflight = fetchHeroEmojiMap(supabase)
    .then((map) => {
      heroEmojiCache.value = map
      heroEmojiCache.fetchedAt = Date.now()
      return map
    })
    .catch((err) => {
      // Never cache a transient error as an empty map; serve stale or rethrow.
      if (heroEmojiCache.value) {
        console.warn(
          `[reference-data-cache] hero emoji fetch failed, serving stale cache: ${err?.message ?? err}`
        )
        return heroEmojiCache.value
      }
      throw err
    })
    .finally(() => {
      heroEmojiCache.inflight = null
    })
  return heroEmojiCache.inflight
}

async function fetchBossMap(
  supabase: SupabaseClient
): Promise<Map<string, Record<string, unknown>>> {
  const { data: bossMappings, error } = await supabase
    .from('boss_mapping')
    .select('boss_type, encounter_index, boss_name')
  if (error) {
    throw new Error(`loadBossMap: ${error.message ?? 'fetch failed'}`)
  }
  if (!bossMappings || bossMappings.length === 0) {
    throw new Error('loadBossMap: empty result from boss_mapping')
  }
  const bossMap = new Map<string, Record<string, unknown>>()
  for (const mapping of bossMappings) {
    const key = `${mapping.boss_type}_${mapping.encounter_index}`
    bossMap.set(key, mapping)
  }
  return bossMap
}

export async function loadBossMap(
  supabase: SupabaseClient
): Promise<Map<string, Record<string, unknown>>> {
  const now = Date.now()
  if (
    bossMapCache.value &&
    now - bossMapCache.fetchedAt < REFERENCE_DATA_TTL_MS
  ) {
    return bossMapCache.value
  }
  if (bossMapCache.inflight) return bossMapCache.inflight

  bossMapCache.inflight = fetchBossMap(supabase)
    .then((map) => {
      bossMapCache.value = map
      bossMapCache.fetchedAt = Date.now()
      return map
    })
    .catch((err) => {
      if (bossMapCache.value) {
        console.warn(
          `[reference-data-cache] boss map fetch failed, serving stale cache: ${err?.message ?? err}`
        )
        return bossMapCache.value
      }
      throw err
    })
    .finally(() => {
      bossMapCache.inflight = null
    })
  return bossMapCache.inflight
}

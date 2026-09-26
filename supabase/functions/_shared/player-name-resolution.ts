// @deno-types="npm:@supabase/supabase-js@2.39.0"
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Pure logic lives in the core module so vitest can test it without this supabase-js import.
import {
  type PlayerNameMap,
  type PlayerNamePageClient,
  createPlayerNameMapCache,
  fetchPlayerNameMapPaged,
  resolveDisplayName
} from './player-name-resolution-core.ts'

export { type PlayerNameMap, resolveDisplayName }

// Concurrent callers share one refresh; a rename reaches Discord within the TTL, inside the hourly cadence.
const PLAYER_NAME_CACHE_TTL_MS = 5 * 60 * 1000

const cachedLoader = createPlayerNameMapCache<SupabaseClient>(
  (supabase) =>
    fetchPlayerNameMapPaged(supabase as unknown as PlayerNamePageClient),
  { ttlMs: PLAYER_NAME_CACHE_TTL_MS, warn: (message) => console.warn(message) }
)

export async function loadPlayerNameMap(
  supabase: SupabaseClient
): Promise<PlayerNameMap> {
  return await cachedLoader(supabase)
}

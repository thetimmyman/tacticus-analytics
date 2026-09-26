// @deno-types="npm:@supabase/supabase-js@2.39.0"
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Display-only labels for duplicate member names: the `(<guildCode>_<NN>)` suffix is a join key for ~30
// RPCs, so keys keep the raw display_name. Deno twin of @/app/lib/member-labels-server.

export type FriendlyLabelMap = Map<string, string>

// Only the fields keyed on are typed.
type DuplicateLabelRow = {
  display_name?: string | null
  friendly_label?: string | null
}

// Small, rarely changing set: short TTL with a shared in-flight refresh.
const LABEL_CACHE_TTL_MS = 5 * 60 * 1000
let cachedMap: FriendlyLabelMap | null = null
let cachedAt = 0
let inflight: Promise<FriendlyLabelMap> | null = null

async function fetchLabelMap(
  supabase: SupabaseClient
): Promise<FriendlyLabelMap> {
  // Empty p_guild_code resolves all guilds in one round-trip.
  const { data, error } = await supabase.rpc('get_duplicate_display_labels', {})
  if (error) {
    throw new Error(`loadDuplicateNameLabels: ${error.message ?? 'rpc failed'}`)
  }

  // Zero rows is a valid, cacheable result (unlike the player-name map).
  const map: FriendlyLabelMap = new Map()
  for (const row of (data ?? []) as DuplicateLabelRow[]) {
    if (row?.display_name && row?.friendly_label) {
      map.set(row.display_name, row.friendly_label)
    }
  }
  return map
}

// Cosmetic, so never throws: on error serve the prior cache or an empty map, never caching the error.
export async function loadDuplicateNameLabels(
  supabase: SupabaseClient
): Promise<FriendlyLabelMap> {
  const now = Date.now()
  if (cachedMap && now - cachedAt < LABEL_CACHE_TTL_MS) {
    return cachedMap
  }
  if (inflight) return inflight

  inflight = fetchLabelMap(supabase)
    .then((map) => {
      cachedMap = map
      cachedAt = Date.now()
      return map
    })
    .catch((err) => {
      console.warn(
        `[duplicate-name-labels] fetch failed, using ${
          cachedMap ? 'stale cache' : 'raw names'
        }: ${err?.message ?? err}`
      )
      // Leave the cache untouched so the next call retries.
      return cachedMap ?? new Map<string, string>()
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

// Display strings only; never apply to keys or persisted identity.
export const relabelForDisplay = (
  name: string | null | undefined,
  labelMap: FriendlyLabelMap
): string => {
  if (!name) return name ?? ''
  return labelMap.get(name) ?? name
}

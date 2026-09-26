// Short-TTL client cache for GET /api/members/roster (the Tacticus branch has no server cache).
// Module-level: payloads are too large for sessionStorage.

export const ROSTER_CACHE_TTL_MS = 60_000

/** Max player/scope entries per module session. */
export const ROSTER_CACHE_MAX_ENTRIES = 40

/** Namespaced by view: consumers store different shapes under unchecked assertions. */
export type RosterCacheScope = 'modal' | 'page'

const ROSTER_CACHE_SCOPES: readonly RosterCacheScope[] = ['modal', 'page']

interface Entry {
  data: object
  storedAt: number
}

const cache = new Map<string, Entry>()

function cacheKey(scope: RosterCacheScope, playerId: string): string {
  return `${scope}:${playerId}`
}

export function readCachedRoster<T extends object>(
  scope: RosterCacheScope,
  playerId: string,
  now: number = Date.now()
): T | null {
  const key = cacheKey(scope, playerId)
  const entry = cache.get(key)
  if (!entry) return null

  const age = now - entry.storedAt
  if (age < 0 || age > ROSTER_CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }

  // Map insertion order is the LRU order.
  cache.delete(key)
  cache.set(key, entry)
  return entry.data as T
}

export function writeCachedRoster<T extends object>(
  scope: RosterCacheScope,
  playerId: string,
  data: T,
  now: number = Date.now()
): void {
  const key = cacheKey(scope, playerId)
  cache.delete(key)
  cache.set(key, { data, storedAt: now })
  while (cache.size > ROSTER_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

export function invalidateCachedRoster(playerId?: string): void {
  if (playerId === undefined) {
    cache.clear()
    return
  }
  for (const scope of ROSTER_CACHE_SCOPES) {
    cache.delete(cacheKey(scope, playerId))
  }
}

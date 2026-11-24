/**
 * Keeps a caller-keyed Map under a hard ceiling. Expired entries are swept first, then the
 * oldest insertion is evicted, because a burst of distinct keys expires nothing inside its
 * window. Inserting without this bound lets untrusted keys grow the Map forever.
 */
export function boundMap<K, V>(
  map: Map<K, V>,
  maxEntries: number,
  isExpired: (value: V, now: number) => boolean,
  sweepBatch = 100
): void {
  if (map.size < maxEntries) return

  const now = Date.now()
  let cleaned = 0
  for (const [key, value] of map) {
    if (isExpired(value, now)) {
      map.delete(key)
      cleaned++
    }
    if (cleaned >= sweepBatch) break
  }

  if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value
    if (oldestKey !== undefined) map.delete(oldestKey)
  }
}

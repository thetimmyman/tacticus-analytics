/** Top-K by partial sort: O(n + k log k) instead of O(n log n). */
export function getTopK<T>(
  array: T[],
  k: number,
  compareFn: (a: T, b: T) => number
): T[] {
  if (k <= 0) {
    return []
  }
  if (k >= array.length) {
    return [...array].sort(compareFn)
  }

  const result = array.slice(0, k)
  result.sort(compareFn)

  for (let i = k; i < array.length; i++) {
    const item = array[i]
    if (item === undefined) {
      continue
    }

    if (compareFn(item, result[k - 1]!) < 0) {
      let left = 0
      let right = k - 1

      while (left < right) {
        const mid = Math.floor((left + right) / 2)
        if (compareFn(item, result[mid]!) < 0) {
          right = mid
        } else {
          left = mid + 1
        }
      }

      result.splice(left, 0, item)
      result.pop()
    }
  }

  return result
}

export function binarySearch<T>(
  sortedArray: T[],
  target: T,
  compareFn: (a: T, b: T) => number
): number {
  let left = 0
  let right = sortedArray.length - 1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const comparison = compareFn(sortedArray[mid]!, target)

    if (comparison === 0) {
      return mid
    } else if (comparison < 0) {
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  return -1 // Not found
}

export function findWithPrefix<T>(
  sortedArray: T[],
  prefix: string,
  getStringValue: (item: T) => string,
  maxResults: number = 10
): T[] {
  const lowerPrefix = prefix.toLowerCase()

  let left = 0
  let right = sortedArray.length - 1
  let firstIndex = -1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const value = getStringValue(sortedArray[mid]!).toLowerCase()

    if (value.startsWith(lowerPrefix)) {
      firstIndex = mid
      right = mid - 1 // Continue searching left
    } else if (value < lowerPrefix) {
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  if (firstIndex === -1) return []

  const results: T[] = []
  for (
    let i = firstIndex;
    i < sortedArray.length && results.length < maxResults;
    i++
  ) {
    const value = getStringValue(sortedArray[i]!).toLowerCase()
    if (!value.startsWith(lowerPrefix)) break
    results.push(sortedArray[i]!)
  }

  return results
}

export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  const groups = {} as Record<K, T[]>

  for (const item of array) {
    const key = keyFn(item)
    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(item)
  }

  return groups
}

/** Deduplicate, keeping first-occurrence order. */
export function uniqueBy<T, K>(array: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>()
  const result: T[] = []

  for (const item of array) {
    const key = keyFn(item)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

export class ArrayOptimizer {
  static searchPlayers<T extends { display_name?: string; name?: string }>(
    players: T[],
    query: string,
    limit: number = 20
  ): T[] {
    if (!players?.length) return []
    const trimmed = query?.trim().toLowerCase()
    if (!trimmed) return players.slice(0, limit)

    const matches = findWithPrefix(
      players,
      trimmed,
      (p) => (p.display_name || p.name || '').toString(),
      limit
    )

    if (matches.length >= limit) return matches.slice(0, limit)

    const remaining = players.filter((p) =>
      (p.display_name || p.name || '')
        .toString()
        .toLowerCase()
        .includes(trimmed)
    )

    return uniqueBy(
      [...matches, ...remaining],
      (p) => p.display_name || p.name || ''
    ).slice(0, limit)
  }
}

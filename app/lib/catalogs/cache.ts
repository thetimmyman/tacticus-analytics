import { apiCache } from '@tacticus/app-core/unified-cache'

export const CACHE_CONFIG = {
  heroes: { ttl: 24 * 60 * 60 * 1000 },
  bosses: { ttl: 24 * 60 * 60 * 1000 },
  storageKey: 'tacticus_catalogs_v2'
} as const

const LEGACY_STORAGE_KEYS = ['tacticus_catalogs_v1'] as const

type CatalogCacheKey = keyof Pick<typeof CACHE_CONFIG, 'heroes' | 'bosses'>

interface CatalogCacheEntry<T> {
  value: T
  storedAt: number
  ttl: number
}

const MEMORY_PREFIX = 'catalogs:'

const canUseStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const readStorage = (): Record<string, CatalogCacheEntry<unknown>> => {
  if (!canUseStorage()) return {}
  try {
    const raw = window.localStorage.getItem(CACHE_CONFIG.storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, CatalogCacheEntry<unknown>>
  } catch {
    return {}
  }
}

const purgeLegacyStorage = () => {
  if (!canUseStorage()) return
  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(legacyKey)
    } catch {
      // Ignore storage failures
    }
  }
}

const writeStorage = (payload: Record<string, CatalogCacheEntry<unknown>>) => {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(
      CACHE_CONFIG.storageKey,
      JSON.stringify(payload)
    )
  } catch {
    // Ignore storage write failures (quota, SSR, etc.)
  }
}

const isExpired = (entry: CatalogCacheEntry<unknown>) =>
  Date.now() - entry.storedAt > entry.ttl

export const getCatalogCache = <T>(key: CatalogCacheKey): T | null => {
  purgeLegacyStorage()

  const memoryKey = `${MEMORY_PREFIX}${key}`
  const memoryValue = apiCache.get(memoryKey) as T | null
  if (memoryValue !== null) {
    return memoryValue
  }

  const payload = readStorage()
  const entry = payload[key] as CatalogCacheEntry<T> | undefined
  if (!entry) return null
  if (isExpired(entry)) {
    delete payload[key]
    writeStorage(payload)
    return null
  }

  const ttlRemaining = Math.max(0, entry.ttl - (Date.now() - entry.storedAt))
  apiCache.set(memoryKey, entry.value, {
    ttl: ttlRemaining,
    priority: 'high',
    tags: ['catalogs', key]
  })
  return entry.value
}

export const setCatalogCache = <T>(
  key: CatalogCacheKey,
  value: T,
  ttl = CACHE_CONFIG[key].ttl
) => {
  const memoryKey = `${MEMORY_PREFIX}${key}`
  apiCache.set(memoryKey, value, {
    ttl,
    priority: 'high',
    tags: ['catalogs', key]
  })

  const payload = readStorage()
  payload[key] = { value, storedAt: Date.now(), ttl }
  writeStorage(payload)
}

export const clearCatalogCache = (key?: CatalogCacheKey) => {
  if (key) {
    apiCache.invalidate(`${MEMORY_PREFIX}${key}`)
    const payload = readStorage()
    delete payload[key]
    writeStorage(payload)
    return
  }

  apiCache.invalidate(`${MEMORY_PREFIX}`)
  if (!canUseStorage()) return
  try {
    window.localStorage.removeItem(CACHE_CONFIG.storageKey)
  } catch {
    // Ignore storage failures
  }
}

/** Unified in-memory cache: TTL, priority LRU, tags, stats. */

import { legacyConsoleLogger as logger } from './logger'

const DISTRIBUTED_CACHE_PREFIX = 'unified:'
const DISTRIBUTED_CACHE_FLAG =
  typeof window === 'undefined' &&
  (['redis', 'app-cache', 'distributed'].includes(
    (process.env.CACHE_BACKEND ?? '').toLowerCase()
  ) ||
    (process.env.APP_CACHE_UNIFIED_CACHE ?? '').toLowerCase() === 'true')

type DistributedCache = typeof import('./app-cache').appCache
let distributedBackend: DistributedCache | null | undefined

const getDistributedBackend = (): DistributedCache | null => {
  if (!DISTRIBUTED_CACHE_FLAG) {
    distributedBackend = null
    return null
  }

  if (distributedBackend !== undefined) {
    return distributedBackend
  }

  // No distributed bridge here: client-bundled hooks import this module, so any
  // `require` would drag Node-only code into the client. Server code uses `appCache`.
  distributedBackend = null

  return distributedBackend ?? null
}

const makeDistributedKey = (key: string): string =>
  `${DISTRIBUTED_CACHE_PREFIX}${key}`

export interface CacheOptions {
  ttl?: number
  priority?: 'low' | 'medium' | 'high' | 'critical'
  tags?: string[]
  onHit?: () => void
  onMiss?: () => void
  onEvict?: (key: string, value: unknown) => void
}

interface CacheEntry<T> {
  value: T
  timestamp: number
  hits: number
  lastAccessed: number
  ttl: number
  priority: number
  tags: string[]
}

export interface CacheStats {
  hits: number
  misses: number
  sets: number
  evictions: number
  size: number
  maxSize: number
  hitRate: number
  memoryUsage: number
}

export class UnifiedCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private entrySizeMap = new Map<string, number>()
  private distributedKeys = new Set<string>()
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0,
    size: 0,
    maxSize: 0,
    hitRate: 0,
    memoryUsage: 0
  }

  /** Monotonic counter: Date.now() is too coarse on some platforms for correct LRU. */
  private accessCounter = 0

  private readonly priorityWeights = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  }
  private readonly name: string

  constructor(
    private maxSize: number = 1000,
    private defaultTTL: number = 5 * 60 * 1000, // 5 minutes
    name: string = 'UnifiedCache'
  ) {
    this.name = name
    this.stats.maxSize = maxSize
  }

  get(key: string, options: CacheOptions = {}): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      this.updateHitRate()
      options.onMiss?.()
      return null
    }

    const now = Date.now()
    if (this.isExpired(entry, now)) {
      this.cache.delete(key)
      this.removeEntrySize(key)
      this.distributedKeys.delete(key)
      void this.deleteFromDistributed(key)
      this.stats.evictions++
      this.stats.misses++
      this.stats.size = this.cache.size
      this.updateHitRate()
      options.onMiss?.()
      return null
    }

    entry.hits++
    entry.lastAccessed = ++this.accessCounter
    this.stats.hits++
    this.updateHitRate()
    options.onHit?.()

    return entry.value
  }

  set(key: string, value: T, options: CacheOptions = {}): void {
    const now = Date.now()
    const ttl = options.ttl ?? this.defaultTTL
    const priority = this.priorityWeights[options.priority ?? 'medium']
    const tags = options.tags ?? []

    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: now,
      hits: 0,
      lastAccessed: ++this.accessCounter,
      ttl,
      priority,
      tags
    }

    this.cache.set(key, entry)
    this.stats.sets++
    this.stats.size = this.cache.size
    this.recordEntrySize(key, entry)
    this.distributedKeys.add(key)
    void this.syncToDistributed(key, entry)
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key)
    if (deleted) {
      this.stats.evictions++
      this.stats.size = this.cache.size
      this.removeEntrySize(key)
      this.distributedKeys.delete(key)
      void this.deleteFromDistributed(key)
    }
    return deleted
  }

  clear(tag?: string): void {
    if (!tag) {
      const size = this.cache.size
      this.cache.clear()
      this.stats.evictions += size
      this.stats.size = 0
      this.entrySizeMap.clear()
      this.stats.memoryUsage = 0
      const keys = Array.from(this.distributedKeys.values())
      this.distributedKeys.clear()
      this.deleteDistributedKeys(keys)
      return
    }

    let evicted = 0
    const distributedDeletes: string[] = []
    for (const [key, entry] of this.cache) {
      if (entry.tags.includes(tag)) {
        this.cache.delete(key)
        evicted++
        this.removeEntrySize(key)
        if (this.distributedKeys.delete(key)) {
          distributedDeletes.push(key)
        }
      }
    }
    this.stats.evictions += evicted
    this.stats.size = this.cache.size
    this.deleteDistributedKeys(distributedDeletes)
  }

  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0,
      memoryUsage: this.estimateMemoryUsage(this.cache.size)
    }
  }

  /** Unexpired, without updating access stats. */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    const isExpired = Date.now() - entry.timestamp > entry.ttl
    if (isExpired) {
      this.cache.delete(key)
      this.stats.evictions++
      this.stats.size = this.cache.size
      this.removeEntrySize(key)
      return false
    }

    return true
  }

  getStats(): CacheStats {
    return { ...this.stats }
  }

  /** Returns even expired values without deleting them. */
  getStale(key: string): { value: T; isStale: boolean } | null {
    const entry = this.cache.get(key)
    if (!entry) {
      return null
    }

    const now = Date.now()
    const isStale = this.isExpired(entry, now)

    if (!isStale) {
      entry.hits++
      entry.lastAccessed = ++this.accessCounter
      this.stats.hits++
      this.updateHitRate()
    }

    return { value: entry.value, isStale }
  }

  async getOrFetch(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const startTime = Date.now()
    const cached = this.get(key, options)

    if (cached !== null) {
      const latencyMs = Date.now() - startTime
      logger.debug(`[${this.name}] Cache hit`, {
        operation: 'getOrFetch',
        key,
        latencyMs,
        result: 'hit'
      })
      return cached
    }

    const distributedEntry = await this.getFromDistributedCache<T>(key)
    if (distributedEntry) {
      const hydrated = this.hydrateFromDistributed(key, distributedEntry)
      if (hydrated) {
        this.stats.hits++
        this.stats.misses = Math.max(0, this.stats.misses - 1)
        this.updateHitRate()
        options.onHit?.()

        const latencyMs = Date.now() - startTime
        logger.debug(`[${this.name}] Cache hit (distributed)`, {
          operation: 'getOrFetch',
          key,
          latencyMs,
          result: 'hit-distributed'
        })
        return hydrated.value
      }
    }

    try {
      const value = await fetchFn()
      this.set(key, value, options)
      const latencyMs = Date.now() - startTime
      logger.debug(`[${this.name}] Cache miss, value fetched`, {
        operation: 'getOrFetch',
        key,
        latencyMs,
        result: 'miss'
      })
      return value
    } catch (error) {
      const latencyMs = Date.now() - startTime
      logger.error(`[${this.name}] Failed to fetch value`, {
        operation: 'getOrFetch',
        key,
        latencyMs,
        result: 'error',
        error
      })
      throw error
    }
  }

  invalidate(pattern?: string | RegExp, tag?: string): number {
    const startTime = Date.now()
    let evicted = 0
    const distributedDeletes: string[] = []

    if (tag) {
      for (const [key, entry] of this.cache) {
        if (entry.tags.includes(tag)) {
          this.cache.delete(key)
          evicted++
          this.removeEntrySize(key)
          if (this.distributedKeys.delete(key)) {
            distributedDeletes.push(key)
          }
        }
      }
    } else if (pattern) {
      for (const key of this.cache.keys()) {
        const shouldEvict =
          typeof pattern === 'string'
            ? key.includes(pattern)
            : pattern.test(key)

        if (shouldEvict) {
          this.cache.delete(key)
          evicted++
          this.removeEntrySize(key)
          if (this.distributedKeys.delete(key)) {
            distributedDeletes.push(key)
          }
        }
      }
    }

    this.stats.evictions += evicted
    this.stats.size = this.cache.size
    this.deleteDistributedKeys(distributedDeletes)

    const latencyMs = Date.now() - startTime
    logger.debug(`[${this.name}] Cache invalidation complete`, {
      operation: 'invalidate',
      keyPrefix: pattern?.toString() || tag || 'all',
      latencyMs,
      result: 'success',
      evictedCount: evicted
    })

    return evicted
  }

  static createClusterKey(key: string, clusterCode?: string): string {
    return clusterCode ? `${clusterCode}:${key}` : key
  }

  setBatch(
    entries: Array<{ key: string; value: T; options?: CacheOptions }>
  ): void {
    for (const { key, value, options } of entries) {
      this.set(key, value, options)
    }
  }

  getBatch(keys: string[], options: CacheOptions = {}): Array<T | null> {
    return keys.map((key) => this.get(key, options))
  }

  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    let lowestPriority = Infinity

    for (const [key, entry] of this.cache) {
      if (
        entry.priority < lowestPriority ||
        (entry.priority === lowestPriority && entry.lastAccessed < oldestTime)
      ) {
        oldestKey = key
        oldestTime = entry.lastAccessed
        lowestPriority = entry.priority
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey)
      this.cache.delete(oldestKey)
      this.stats.evictions++
      this.stats.size = this.cache.size
      this.removeEntrySize(oldestKey)
      this.distributedKeys.delete(oldestKey)
      void this.deleteFromDistributed(oldestKey)

      if (entry?.tags.includes('onEvict')) {
        // onEvict callback not implemented.
      }
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0
  }

  private isExpired(entry: CacheEntry<T>, now: number): boolean {
    return now - entry.timestamp > entry.ttl
  }

  private async getFromDistributedCache<Value>(
    key: string
  ): Promise<CacheEntry<Value> | null> {
    const backend = getDistributedBackend()
    if (!backend) {
      return null
    }

    try {
      return await backend.get<CacheEntry<Value>>(makeDistributedKey(key))
    } catch (error) {
      logger.warn(`[${this.name}] Failed to read from appCache backend`, {
        operation: 'get',
        keyPrefix: key.split(':')[0],
        error
      })
      return null
    }
  }

  private hydrateFromDistributed(
    key: string,
    entry: CacheEntry<T>
  ): CacheEntry<T> | null {
    const now = Date.now()
    const ttlRemaining = entry.ttl - (now - entry.timestamp)
    if (ttlRemaining <= 0) {
      void this.deleteFromDistributed(key)
      return null
    }

    const hydrated: CacheEntry<T> = {
      value: entry.value,
      timestamp: now,
      hits: entry.hits + 1,
      lastAccessed: ++this.accessCounter,
      ttl: ttlRemaining,
      priority: entry.priority,
      tags: entry.tags
    }

    this.cache.set(key, hydrated)
    this.distributedKeys.add(key)
    this.stats.size = this.cache.size
    this.recordEntrySize(key, hydrated)

    return hydrated
  }

  private async syncToDistributed(
    key: string,
    entry: CacheEntry<T>
  ): Promise<void> {
    const backend = getDistributedBackend()
    if (!backend) {
      return
    }

    const ttlSeconds = Math.max(1, Math.ceil(entry.ttl / 1000))

    try {
      await backend.set(makeDistributedKey(key), entry, ttlSeconds)
    } catch (error) {
      logger.warn(`[${this.name}] Failed to write entry to appCache backend`, {
        operation: 'set',
        keyPrefix: key.split(':')[0],
        error
      })
    }
  }

  private async deleteFromDistributed(key: string): Promise<void> {
    const backend = getDistributedBackend()
    if (!backend) {
      return
    }

    try {
      await backend.del(makeDistributedKey(key))
    } catch (error) {
      logger.warn(`[${this.name}] Failed to delete appCache entry`, {
        operation: 'del',
        keyPrefix: key.split(':')[0],
        error
      })
    }
  }

  private deleteDistributedKeys(keys: string[]): void {
    const backend = getDistributedBackend()
    if (!backend || keys.length === 0) {
      return
    }

    for (const key of keys) {
      void backend.del(makeDistributedKey(key))
    }
  }

  cleanup(): number {
    const startTime = Date.now()
    const now = Date.now()
    let cleaned = 0
    const distributedDeletes: string[] = []

    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry, now)) {
        this.cache.delete(key)
        cleaned++
        this.removeEntrySize(key)
        if (this.distributedKeys.delete(key)) {
          distributedDeletes.push(key)
        }
      }
    }

    this.stats.evictions += cleaned
    this.stats.size = this.cache.size
    if (cleaned > 0) {
      this.stats.memoryUsage = this.estimateMemoryUsage(this.cache.size)
      this.deleteDistributedKeys(distributedDeletes)
    }

    const latencyMs = Date.now() - startTime
    logger.debug(`[${this.name}] Cache cleanup complete`, {
      operation: 'cleanup',
      keyPrefix: 'all',
      latencyMs,
      result: 'success',
      cleanedCount: cleaned
    })

    return cleaned
  }

  private estimateMemoryUsage(entryCount: number): number {
    if (entryCount === 0 || this.entrySizeMap.size === 0) {
      return 0
    }
    let total = 0
    for (const size of this.entrySizeMap.values()) {
      total += size
    }
    return total
  }

  private recordEntrySize(key: string, entry: CacheEntry<T>): void {
    const previousSize = this.entrySizeMap.get(key) ?? 0
    const newSize = this.calculateEntryFootprint(entry)
    this.entrySizeMap.set(key, newSize)
    this.stats.memoryUsage = Math.max(
      0,
      this.stats.memoryUsage - previousSize + newSize
    )
  }

  private removeEntrySize(key: string): void {
    const previousSize = this.entrySizeMap.get(key)
    if (previousSize === undefined) {
      return
    }
    this.entrySizeMap.delete(key)
    this.stats.memoryUsage = Math.max(0, this.stats.memoryUsage - previousSize)
  }

  private calculateEntryFootprint(entry: CacheEntry<T>): number {
    const metadataOverhead = 128 + entry.tags.join(',').length * 2
    const valueSize = this.estimateValueSize(entry.value)
    return metadataOverhead + valueSize
  }

  private estimateValueSize(value: T): number {
    if (value === null || value === undefined) {
      return 0
    }

    if (typeof value === 'string') {
      return value.length * 2
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return 8
    }

    if (value instanceof Buffer) {
      return value.length
    }

    try {
      const json = JSON.stringify(value)
      return json ? json.length * 2 : 0
    } catch {
      return 512
    }
  }
}

export const mainCache = new UnifiedCache<unknown>(
  2000,
  10 * 60 * 1000,
  'MainCache'
) // 10 min default
export const apiCache = new UnifiedCache<unknown>(
  1000,
  5 * 60 * 1000,
  'APICache'
) // 5 min default
export const tokenCache = new UnifiedCache<unknown>(
  500,
  2 * 60 * 1000,
  'TokenCache'
) // 2 min default

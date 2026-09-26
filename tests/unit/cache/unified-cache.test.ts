import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UnifiedCache } from '@tacticus/app-core/unified-cache'

describe('UnifiedCache', () => {
  let cache: UnifiedCache<unknown>

  beforeEach(() => {
    cache = new UnifiedCache<unknown>(100, 5 * 60 * 1000, 'TestCache')
  })

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull()
    })

    it('should delete keys', () => {
      cache.set('key1', 'value1')
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeNull()
    })

    it('should check key existence', () => {
      cache.set('key1', 'value1')
      expect(cache.has('key1')).toBe(true)
      expect(cache.has('nonexistent')).toBe(false)
    })

    it('should clear all entries', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.clear()
      expect(cache.get('key1')).toBeNull()
      expect(cache.get('key2')).toBeNull()
    })
  })

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
      const shortTTL = 50 // 50ms
      cache.set('key1', 'value1', { ttl: shortTTL })

      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(shortTTL + 10)

      expect(cache.get('key1')).toBeNull()
      vi.useRealTimers()
    })

    it('should use custom TTL over default', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
      const customTTL = 100
      cache.set('key1', 'value1', { ttl: customTTL })

      vi.advanceTimersByTime(50)
      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(customTTL)
      expect(cache.get('key1')).toBeNull()
      vi.useRealTimers()
    })

    it('should cleanup expired entries manually', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
      cache.set('key1', 'value1', { ttl: 50 })
      cache.set('key2', 'value2', { ttl: 5000 })

      vi.advanceTimersByTime(60)

      const cleaned = cache.cleanup()
      expect(cleaned).toBeGreaterThanOrEqual(1)
      expect(cache.get('key1')).toBeNull()
      expect(cache.get('key2')).toBe('value2')
      vi.useRealTimers()
    })
  })

  describe('LRU Eviction', () => {
    it('should evict least recently used when at capacity', () => {
      const smallCache = new UnifiedCache<string>(3, 60000)

      smallCache.set('key1', 'value1')
      smallCache.set('key2', 'value2')
      smallCache.set('key3', 'value3')

      smallCache.get('key1')

      smallCache.set('key4', 'value4')

      expect(smallCache.get('key1')).toBe('value1')
      expect(smallCache.get('key2')).toBeNull()
      expect(smallCache.get('key3')).toBe('value3')
      expect(smallCache.get('key4')).toBe('value4')
    })

    it('should respect priority during eviction', () => {
      const smallCache = new UnifiedCache<string>(3, 60000)

      smallCache.set('low', 'value1', { priority: 'low' })
      smallCache.set('high', 'value2', { priority: 'high' })
      smallCache.set('medium', 'value3', { priority: 'medium' })

      smallCache.set('key4', 'value4', { priority: 'medium' })

      expect(smallCache.get('low')).toBeNull()
      expect(smallCache.get('high')).toBe('value2')
      expect(smallCache.get('medium')).toBe('value3')
    })

    it('should track eviction statistics', () => {
      const smallCache = new UnifiedCache<string>(2, 60000)

      smallCache.set('key1', 'value1')
      smallCache.set('key2', 'value2')
      smallCache.set('key3', 'value3') // Triggers eviction

      const stats = smallCache.getStats()
      expect(stats.evictions).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Tag-based Invalidation', () => {
    it('should invalidate entries by tag', () => {
      cache.set('user:1', 'data1', { tags: ['users'] })
      cache.set('user:2', 'data2', { tags: ['users'] })
      cache.set('post:1', 'data3', { tags: ['posts'] })

      cache.clear('users')

      expect(cache.get('user:1')).toBeNull()
      expect(cache.get('user:2')).toBeNull()
      expect(cache.get('post:1')).toBe('data3')
    })

    it('should invalidate entries by pattern', () => {
      cache.set('user:1', 'data1')
      cache.set('user:2', 'data2')
      cache.set('post:1', 'data3')

      const evicted = cache.invalidate('user:')

      expect(evicted).toBe(2)
      expect(cache.get('user:1')).toBeNull()
      expect(cache.get('user:2')).toBeNull()
      expect(cache.get('post:1')).toBe('data3')
    })

    it('should invalidate entries by RegExp', () => {
      cache.set('user:1', 'data1')
      cache.set('user:2', 'data2')
      cache.set('post:1', 'data3')

      const evicted = cache.invalidate(/^user:/)

      expect(evicted).toBe(2)
      expect(cache.get('post:1')).toBe('data3')
    })
  })

  describe('getOrFetch Pattern', () => {
    it('should return cached value on hit', async () => {
      const fetchFn = vi.fn(async () => 'fetched-value')

      cache.set('key1', 'cached-value')
      const result = await cache.getOrFetch('key1', fetchFn)

      expect(result).toBe('cached-value')
      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('should fetch and cache on miss', async () => {
      const fetchFn = vi.fn(async () => 'fetched-value')

      const result = await cache.getOrFetch('key1', fetchFn)

      expect(result).toBe('fetched-value')
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(cache.get('key1')).toBe('fetched-value')
    })

    it('should propagate fetch errors', async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error('Fetch failed')
      })

      await expect(cache.getOrFetch('key1', fetchFn)).rejects.toThrow(
        'Fetch failed'
      )
    })

    it('should use custom TTL for fetched values', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
      const fetchFn = vi.fn(async () => 'value')
      const customTTL = 100

      await cache.getOrFetch('key1', fetchFn, { ttl: customTTL })

      vi.advanceTimersByTime(50)
      expect(cache.get('key1')).toBe('value')

      vi.advanceTimersByTime(customTTL)
      expect(cache.get('key1')).toBeNull()
      vi.useRealTimers()
    })
  })

  describe('Batch Operations', () => {
    it('should set multiple entries at once', () => {
      cache.setBatch([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
        { key: 'key3', value: 'value3' }
      ])

      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBe('value2')
      expect(cache.get('key3')).toBe('value3')
    })

    it('should get multiple entries at once', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      const values = cache.getBatch(['key1', 'key2', 'nonexistent'])

      expect(values).toEqual(['value1', 'value2', null])
    })
  })

  describe('Statistics', () => {
    it('should track hit and miss counts', () => {
      cache.set('key1', 'value1')

      cache.get('key1') // hit
      cache.get('key1') // hit
      cache.get('nonexistent') // miss

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(1)
    })

    it('should calculate hit rate', () => {
      cache.set('key1', 'value1')

      cache.get('key1') // hit
      cache.get('nonexistent') // miss

      const stats = cache.getStats()
      expect(stats.hitRate).toBe(0.5)
    })

    it('should track cache size', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      const stats = cache.getStats()
      expect(stats.size).toBe(2)
      expect(stats.maxSize).toBe(100)
    })

    it('should estimate memory usage', () => {
      cache.set('k1', 'short')
      const stats = cache.getStats()
      expect(stats.memoryUsage).toBeGreaterThan(0)
    })

    it('should increment evictions on explicit delete', () => {
      cache.set('k1', 'v1') // set +1
      cache.get('k1') // hit +1
      cache.get('k2') // miss +1
      cache.delete('k1') // eviction +1 (delete() increments evictions)

      const stats = cache.getStats()
      expect(stats.sets).toBe(1)
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
      expect(stats.evictions).toBe(1)
      expect(stats.size).toBe(0)
    })
  })

  describe('resetStats', () => {
    it('should zero counters but keep cached entries', () => {
      cache.set('key1', 'value1')
      cache.get('key1')
      cache.get('missing')

      cache.resetStats()
      const stats = cache.getStats()

      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.size).toBe(1)
    })
  })

  describe('Callbacks', () => {
    it('should call onHit callback', () => {
      const onHit = vi.fn()

      cache.set('key1', 'value1')
      cache.get('key1', { onHit })

      expect(onHit).toHaveBeenCalledTimes(1)
    })

    it('should call onMiss callback', () => {
      const onMiss = vi.fn()

      cache.get('nonexistent', { onMiss })

      expect(onMiss).toHaveBeenCalledTimes(1)
    })
  })

  describe('Cluster Keys', () => {
    it('should create cluster-aware keys', () => {
      const clusterKey = UnifiedCache.createClusterKey('user:1', 'EOT')
      expect(clusterKey).toBe('EOT:user:1')
    })

    it('should return plain key without cluster code', () => {
      const plainKey = UnifiedCache.createClusterKey('user:1')
      expect(plainKey).toBe('user:1')
    })
  })
})

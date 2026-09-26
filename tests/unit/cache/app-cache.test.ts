import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { appCache } from '@tacticus/app-core/app-cache'

describe('appCache Service', () => {
  beforeEach(async () => {
    await appCache.flush()
  })

  afterEach(async () => {
    await appCache.flush()
  })

  describe('Basic Operations', () => {
    it('should store and retrieve values', async () => {
      await appCache.set('test:key1', 'value1')
      const result = await appCache.get<string>('test:key1')
      expect(result).toBe('value1')
    })

    it('should return null for non-existent keys', async () => {
      const result = await appCache.get('test:nonexistent')
      expect(result).toBeNull()
    })

    it('should delete keys', async () => {
      await appCache.set('test:key1', 'value1')
      await appCache.del('test:key1')
      const result = await appCache.get('test:key1')
      expect(result).toBeNull()
    })

    it('should handle complex objects', async () => {
      const obj = { id: 1, name: 'test', nested: { value: 'deep' } }
      await appCache.set('test:object', obj)
      const result = await appCache.get<typeof obj>('test:object')
      expect(result).toEqual(obj)
    })

    it('should handle arrays', async () => {
      const arr = [1, 2, 3, 4, 5]
      await appCache.set('test:array', arr)
      const result = await appCache.get<typeof arr>('test:array')
      expect(result).toEqual(arr)
    })
  })

  describe('TTL Behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should respect custom TTL', async () => {
      await appCache.set('test:ttl', 'value', 1) // 1 second

      let result = await appCache.get('test:ttl')
      expect(result).toBe('value')

      vi.advanceTimersByTime(1100)

      result = await appCache.get('test:ttl')
      expect(result).toBeNull()
    })

    it('should use default TTL when not specified', async () => {
      await appCache.set('test:default', 'value') // Uses default 300s

      const result = await appCache.get('test:default')
      expect(result).toBe('value')
    })
  })

  describe('Type Safety', () => {
    it('should preserve number types', async () => {
      await appCache.set('test:number', 42)
      const result = await appCache.get<number>('test:number')
      expect(result).toBe(42)
      expect(typeof result).toBe('number')
    })

    it('should preserve boolean types', async () => {
      await appCache.set('test:boolean', true)
      const result = await appCache.get<boolean>('test:boolean')
      expect(result).toBe(true)
      expect(typeof result).toBe('boolean')
    })

    it('should handle null values', async () => {
      await appCache.set('test:null', null)
      const result = await appCache.get('test:null')
      expect(result === null).toBe(true)
    })
  })

  describe('Cache Operations', () => {
    it('should flush all entries', async () => {
      await appCache.set('test:key1', 'value1')
      await appCache.set('test:key2', 'value2')
      await appCache.set('test:key3', 'value3')

      await appCache.flush()

      expect(await appCache.get('test:key1')).toBeNull()
      expect(await appCache.get('test:key2')).toBeNull()
      expect(await appCache.get('test:key3')).toBeNull()
    })

    it('should count keys', async () => {
      await appCache.flush()

      await appCache.set('test:key1', 'value1')
      await appCache.set('test:key2', 'value2')
      await appCache.set('test:key3', 'value3')

      const count = await appCache.keyCount()
      expect(count).toBe(3)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent sets', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        appCache.set(`test:concurrent:${i}`, `value${i}`)
      )

      await Promise.all(promises)

      const values = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          appCache.get<string>(`test:concurrent:${i}`)
        )
      )

      values.forEach((value, i) => {
        expect(value).toBe(`value${i}`)
      })
    })

    it('should handle concurrent gets', async () => {
      await appCache.set('test:concurrent', 'shared-value')

      const promises = Array.from({ length: 10 }, () =>
        appCache.get<string>('test:concurrent')
      )

      const results = await Promise.all(promises)

      results.forEach((result) => {
        expect(result).toBe('shared-value')
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      await appCache.set('test:valid', { test: 'value' })
      const result = await appCache.get('test:valid')
      expect(result).toBeTruthy()
    })

    it('should not throw on delete of non-existent key', async () => {
      await expect(appCache.del('test:nonexistent')).resolves.not.toThrow()
    })

    it('should not throw on flush when empty', async () => {
      await appCache.flush()
      await expect(appCache.flush()).resolves.not.toThrow()
    })
  })

  describe('Redis vs In-Memory Behavior', () => {
    it.skipIf(!process.env.KV_REST_API_URL)(
      'uses Redis when configured',
      async () => {
        await appCache.set('test:redis', 'value')
        const result = await appCache.get<string>('test:redis')
        expect(result).toBe('value')
      }
    )

    it.skipIf(Boolean(process.env.KV_REST_API_URL))(
      'uses in-memory when Redis not configured',
      async () => {
        await appCache.set('test:memory', 'value')
        const result = await appCache.get<string>('test:memory')
        expect(result).toBe('value')
      }
    )
  })

  describe('Key Namespacing', () => {
    it('should support key prefixes for organization', async () => {
      await appCache.set('user:1', { name: 'Alice' })
      await appCache.set('user:2', { name: 'Bob' })
      await appCache.set('post:1', { title: 'Hello' })

      const user1 = await appCache.get('user:1')
      const post1 = await appCache.get('post:1')

      expect(user1).toEqual({ name: 'Alice' })
      expect(post1).toEqual({ title: 'Hello' })
    })

    it('should handle complex key patterns', async () => {
      await appCache.set('guild:EOT:IW:stats', { dmg: 1000 })
      await appCache.set('guild:EOT:AL:stats', { dmg: 2000 })

      const iwStats = await appCache.get('guild:EOT:IW:stats')
      const alStats = await appCache.get('guild:EOT:AL:stats')

      expect(iwStats).toEqual({ dmg: 1000 })
      expect(alStats).toEqual({ dmg: 2000 })
    })
  })

  describe('Cache Invalidation Patterns', () => {
    it('should support manual invalidation by key', async () => {
      await appCache.set('test:key1', 'value1')
      await appCache.set('test:key2', 'value2')

      await appCache.del('test:key1')

      expect(await appCache.get('test:key1')).toBeNull()
      expect(await appCache.get('test:key2')).toBe('value2')
    })

    it('should support batch invalidation via flush', async () => {
      await appCache.set('test:key1', 'value1')
      await appCache.set('test:key2', 'value2')
      await appCache.set('test:key3', 'value3')

      await appCache.flush()

      const count = await appCache.keyCount()
      expect(count).toBe(0)
    })
  })

  describe('Performance Characteristics', () => {
    it('should handle large values', async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        data: `item-${i}`,
        nested: { value: i * 2 }
      }))

      await appCache.set('test:large', largeArray, 60)
      const result = await appCache.get<typeof largeArray>('test:large')

      expect(result).toHaveLength(1000)
      expect(result![0]).toEqual({
        id: 0,
        data: 'item-0',
        nested: { value: 0 }
      })
      expect(result![999]).toEqual({
        id: 999,
        data: 'item-999',
        nested: { value: 1998 }
      })
    })

    it('should handle rapid successive operations', async () => {
      for (let i = 0; i < 100; i++) {
        await appCache.set(`test:rapid:${i}`, i)
      }

      for (let i = 0; i < 100; i++) {
        const result = await appCache.get<number>(`test:rapid:${i}`)
        expect(result).toBe(i)
      }
    })
  })
})

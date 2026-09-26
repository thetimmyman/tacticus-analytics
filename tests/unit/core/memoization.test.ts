import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  memoize,
  memoizeSync,
  SimpleCache
} from '@tacticus/app-core/memoization'

describe('Memoization Utilities', () => {
  describe('SimpleCache', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('stores and retrieves values', () => {
      const cache = new SimpleCache<string>()
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('returns null for missing keys', () => {
      const cache = new SimpleCache<string>()
      expect(cache.get('missing')).toBeNull()
    })

    it('expires entries after TTL', () => {
      const cache = new SimpleCache<string>(1000) // 1 second TTL
      cache.set('key1', 'value1')

      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(500)
      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(600) // Total: 1100ms
      expect(cache.get('key1')).toBeNull()
    })

    it('clears all entries', () => {
      const cache = new SimpleCache<string>()
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      expect(cache.size()).toBe(2)

      cache.clear()

      expect(cache.size()).toBe(0)
      expect(cache.get('key1')).toBeNull()
    })

    it('reports size correctly', () => {
      const cache = new SimpleCache<string>()
      expect(cache.size()).toBe(0)

      cache.set('key1', 'value1')
      expect(cache.size()).toBe(1)

      cache.set('key2', 'value2')
      expect(cache.size()).toBe(2)
    })

    it('cleans up old entries when cache exceeds 100 items', () => {
      const cache = new SimpleCache<number>(60000)

      for (let i = 0; i < 101; i++) {
        cache.set(`key${i}`, i)
        vi.advanceTimersByTime(10) // Small time increment
      }

      expect(cache.size()).toBeLessThanOrEqual(101)
    })

    it('uses 5 minute default TTL', () => {
      const cache = new SimpleCache<string>()
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(4 * 60 * 1000)
      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(2 * 60 * 1000)
      expect(cache.get('key1')).toBeNull()
    })
  })

  describe('memoizeSync', () => {
    it('caches function results', () => {
      let callCount = 0
      const fn = (x: number) => {
        callCount++
        return x * 2
      }

      const memoized = memoizeSync(fn)

      expect(memoized(5)).toBe(10)
      expect(callCount).toBe(1)

      expect(memoized(5)).toBe(10)
      expect(callCount).toBe(1) // Not called again

      expect(memoized(10)).toBe(20)
      expect(callCount).toBe(2) // Called for new argument
    })

    it('uses custom key generator', () => {
      let callCount = 0
      const fn = (obj: { id: number }) => {
        callCount++
        return obj.id * 2
      }

      const memoized = memoizeSync(fn, {
        keyGenerator: (obj) => String(obj.id)
      })

      expect(memoized({ id: 5 })).toBe(10)
      expect(callCount).toBe(1)

      expect(memoized({ id: 5 })).toBe(10)
      expect(callCount).toBe(1)
    })

    it('handles multiple arguments', () => {
      let callCount = 0
      const fn = (a: number, b: number) => {
        callCount++
        return a + b
      }

      const memoized = memoizeSync(fn)

      expect(memoized(1, 2)).toBe(3)
      expect(memoized(1, 2)).toBe(3)
      expect(callCount).toBe(1)

      expect(memoized(2, 1)).toBe(3)
      expect(callCount).toBe(2) // Different args
    })

    it('respects TTL', () => {
      vi.useFakeTimers()

      let callCount = 0
      const fn = () => {
        callCount++
        return 'result'
      }

      const memoized = memoizeSync(fn, { ttl: 1000 })

      expect(memoized()).toBe('result')
      expect(callCount).toBe(1)

      vi.advanceTimersByTime(500)
      expect(memoized()).toBe('result')
      expect(callCount).toBe(1)

      vi.advanceTimersByTime(600)
      expect(memoized()).toBe('result')
      expect(callCount).toBe(2) // Re-computed after TTL

      vi.useRealTimers()
    })

    it('handles non-serializable arguments', () => {
      const fn = (obj: object) => Object.prototype.toString.call(obj)
      const circular: Record<string, unknown> = {}
      circular.self = circular

      const memoized = memoizeSync(fn)

      expect(() => memoized(circular)).not.toThrow()
    })
  })

  describe('memoize (async)', () => {
    it('caches async function results', async () => {
      let callCount = 0
      const fn = async (x: number) => {
        callCount++
        return x * 2
      }

      const memoized = memoize(fn)

      expect(await memoized(5)).toBe(10)
      expect(callCount).toBe(1)

      expect(await memoized(5)).toBe(10)
      expect(callCount).toBe(1)

      expect(await memoized(10)).toBe(20)
      expect(callCount).toBe(2)
    })

    it('uses custom key generator', async () => {
      let callCount = 0
      const fn = async (obj: { id: number }) => {
        callCount++
        return obj.id * 2
      }

      const memoized = memoize(fn, {
        keyGenerator: (obj) => String(obj.id)
      })

      expect(await memoized({ id: 5 })).toBe(10)
      expect(callCount).toBe(1)

      expect(await memoized({ id: 5 })).toBe(10)
      expect(callCount).toBe(1)
    })

    it('handles promise rejections', async () => {
      const fn = async () => {
        throw new Error('Test error')
      }

      const memoized = memoize(fn)

      await expect(memoized()).rejects.toThrow('Test error')
    })

    it('respects TTL for async functions', async () => {
      vi.useFakeTimers()

      let callCount = 0
      const fn = async () => {
        callCount++
        return 'result'
      }

      const memoized = memoize(fn, { ttl: 1000 })

      expect(await memoized()).toBe('result')
      expect(callCount).toBe(1)

      vi.advanceTimersByTime(500)
      expect(await memoized()).toBe('result')
      expect(callCount).toBe(1)

      vi.advanceTimersByTime(600)
      expect(await memoized()).toBe('result')
      expect(callCount).toBe(2)

      vi.useRealTimers()
    })
  })
})

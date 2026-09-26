import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  deduplicateRequest,
  createRequestKey,
  clearPendingRequests,
  getPendingRequestStats
} from '@/app/lib/utils/request-deduplication'

describe('Request Deduplication Utilities', () => {
  beforeEach(() => {
    clearPendingRequests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    clearPendingRequests()
    vi.useRealTimers()
  })

  describe('createRequestKey', () => {
    it('creates key from operation only', () => {
      expect(createRequestKey('fetchUsers')).toBe('fetchUsers')
      expect(createRequestKey('getData')).toBe('getData')
    })

    it('creates key with single parameter', () => {
      const key = createRequestKey('fetchUser', { id: '123' })

      expect(key).toBe('fetchUser?id="123"')
    })

    it('creates key with multiple parameters in sorted order', () => {
      const key = createRequestKey('search', {
        z: 'last',
        a: 'first',
        m: 'middle'
      })

      expect(key).toBe('search?a="first"&m="middle"&z="last"')
    })

    it('handles numeric parameter values', () => {
      const key = createRequestKey('getPage', { page: 5, limit: 10 })

      expect(key).toContain('page=5')
      expect(key).toContain('limit=10')
    })

    it('handles boolean parameter values', () => {
      const key = createRequestKey('filter', { active: true, deleted: false })

      expect(key).toContain('active=true')
      expect(key).toContain('deleted=false')
    })

    it('handles null and undefined values', () => {
      const key = createRequestKey('test', {
        nullVal: null,
        undefinedVal: undefined
      })

      expect(key).toContain('nullVal=null')
    })

    it('handles array values', () => {
      const key = createRequestKey('filter', { ids: [1, 2, 3] })

      expect(key).toContain('ids=[1,2,3]')
    })

    it('handles object values', () => {
      const key = createRequestKey('complex', { filter: { name: 'test' } })

      expect(key).toContain('filter={"name":"test"}')
    })

    it('returns only operation for empty params', () => {
      expect(createRequestKey('op', {})).toBe('op')
    })
  })

  describe('deduplicateRequest', () => {
    it('executes request function', async () => {
      const mockFn = vi.fn().mockResolvedValue('result')

      const result = await deduplicateRequest('key1', mockFn)

      expect(mockFn).toHaveBeenCalledTimes(1)
      expect(result).toBe('result')
    })

    it('returns same promise for concurrent identical requests', async () => {
      let callCount = 0
      const mockFn = vi.fn().mockImplementation(async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 100))
        return `result-${callCount}`
      })

      const promise1 = deduplicateRequest('same-key', mockFn)
      const promise2 = deduplicateRequest('same-key', mockFn)

      expect(promise1).toBe(promise2)

      await vi.advanceTimersByTimeAsync(100)

      const [result1, result2] = await Promise.all([promise1, promise2])

      expect(result1).toBe(result2)
      expect(mockFn).toHaveBeenCalledTimes(1)
    })

    it('executes separate requests for different keys', async () => {
      const mockFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return 'result'
      })

      const promise1 = deduplicateRequest('key-a', mockFn)
      const promise2 = deduplicateRequest('key-b', mockFn)

      expect(promise1).not.toBe(promise2)

      await vi.advanceTimersByTimeAsync(50)
      await Promise.all([promise1, promise2])

      expect(mockFn).toHaveBeenCalledTimes(2)
    })

    it('cleans up after request completes', async () => {
      const mockFn = vi.fn().mockResolvedValue('done')

      await deduplicateRequest('cleanup-key', mockFn)

      await vi.advanceTimersByTimeAsync(0)

      const stats = getPendingRequestStats()
      expect(stats.keys).not.toContain('cleanup-key')
    })

    it('handles request errors gracefully', async () => {
      const error = new Error('Request failed')
      const mockFn = vi.fn().mockRejectedValue(error)

      await expect(deduplicateRequest('error-key', mockFn)).rejects.toThrow(
        'Request failed'
      )

      await vi.advanceTimersByTimeAsync(0)
      const stats = getPendingRequestStats()
      expect(stats.keys).not.toContain('error-key')
    })
  })

  describe('clearPendingRequests', () => {
    it('clears all pending requests', async () => {
      const slowFn = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 10000))
        )

      deduplicateRequest('pending-1', slowFn)
      deduplicateRequest('pending-2', slowFn)

      expect(getPendingRequestStats().count).toBe(2)

      clearPendingRequests()

      expect(getPendingRequestStats().count).toBe(0)
    })

    it('allows new requests after clearing', async () => {
      const mockFn = vi.fn().mockResolvedValue('new-result')

      clearPendingRequests()
      const result = await deduplicateRequest('new-key', mockFn)

      expect(result).toBe('new-result')
      expect(mockFn).toHaveBeenCalled()
    })
  })

  describe('getPendingRequestStats', () => {
    it('returns zero count when no requests pending', () => {
      clearPendingRequests()
      const stats = getPendingRequestStats()

      expect(stats.count).toBe(0)
      expect(stats.keys).toEqual([])
    })

    it('returns accurate count of pending requests', async () => {
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 10000))

      deduplicateRequest('stat-key-1', slowFn)
      deduplicateRequest('stat-key-2', slowFn)
      deduplicateRequest('stat-key-3', slowFn)

      const stats = getPendingRequestStats()

      expect(stats.count).toBe(3)
    })

    it('returns list of pending request keys', async () => {
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 10000))

      deduplicateRequest('key-alpha', slowFn)
      deduplicateRequest('key-beta', slowFn)

      const stats = getPendingRequestStats()

      expect(stats.keys).toContain('key-alpha')
      expect(stats.keys).toContain('key-beta')
    })

    it('does not include completed requests', async () => {
      const fastFn = vi.fn().mockResolvedValue('done')

      await deduplicateRequest('fast-key', fastFn)
      await vi.advanceTimersByTimeAsync(0)

      const stats = getPendingRequestStats()

      expect(stats.keys).not.toContain('fast-key')
    })
  })
})

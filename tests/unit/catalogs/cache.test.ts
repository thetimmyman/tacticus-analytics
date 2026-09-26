import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CACHE_CONFIG,
  clearCatalogCache,
  getCatalogCache,
  setCatalogCache
} from '@/app/lib/catalogs/cache'

describe('catalog cache', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    localStorage.getItem = (key: string) => storage.get(key) ?? null
    localStorage.setItem = (key: string, value: string) => {
      storage.set(key, value)
    }
    localStorage.removeItem = (key: string) => {
      storage.delete(key)
    }
    localStorage.clear = () => {
      storage.clear()
    }
  })

  afterEach(() => {
    clearCatalogCache()
    localStorage.clear()
  })

  it('stores and retrieves catalog data', () => {
    setCatalogCache('heroes', ['alpha'])
    const cached = getCatalogCache<string[]>('heroes')
    expect(cached).toEqual(['alpha'])
  })

  it('rehydrates from localStorage', () => {
    const payload = {
      heroes: {
        value: ['beta'],
        storedAt: Date.now(),
        ttl: CACHE_CONFIG.heroes.ttl
      }
    }
    localStorage.setItem(CACHE_CONFIG.storageKey, JSON.stringify(payload))

    const cached = getCatalogCache<string[]>('heroes')
    expect(cached).toEqual(['beta'])
  })

  it('returns null and evicts a localStorage entry whose ttl has expired', () => {
    // Bypass the in-memory apiCache so the TTL/evict branch runs.
    const ttl = 1_000 // 1s ttl
    const stalePayload = {
      heroes: {
        value: ['stale'],
        storedAt: Date.now() - 60_000, // 60s ago, well past the 1s ttl
        ttl
      },
      bosses: {
        value: ['fresh-boss'],
        storedAt: Date.now(),
        ttl: CACHE_CONFIG.bosses.ttl
      }
    }
    localStorage.setItem(CACHE_CONFIG.storageKey, JSON.stringify(stalePayload))

    expect(getCatalogCache<string[]>('heroes')).toBeNull()

    const afterRead = JSON.parse(
      localStorage.getItem(CACHE_CONFIG.storageKey) as string
    )
    expect(afterRead.heroes).toBeUndefined()
    expect(afterRead.bosses?.value).toEqual(['fresh-boss'])
    expect(getCatalogCache<string[]>('bosses')).toEqual(['fresh-boss'])
  })
})

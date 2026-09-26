import { beforeEach, describe, expect, it } from 'vitest'

// Keyed on caller input; an expiry sweep frees nothing in a burst, so insert must evict at MAX_CACHE_SIZE.
describe('proxy sessionCache has a real ceiling', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://api.tacticusanalytics.com'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    process.env.SUPABASE_URL = 'http://supabase-kong:8000'
  })

  it('never exceeds MAX_CACHE_SIZE when a burst of distinct keys arrives inside the TTL', async () => {
    const { __internal } = await import('@/proxy')
    const { sessionCache, setCachedUser, MAX_CACHE_SIZE } = __internal

    expect(sessionCache.size).toBe(0)

    const burst = MAX_CACHE_SIZE + 50
    for (let i = 0; i < burst; i++) {
      setCachedUser(`burst-key-${i}`, null)
    }

    expect(sessionCache.size).toBeLessThanOrEqual(MAX_CACHE_SIZE)
  })
})

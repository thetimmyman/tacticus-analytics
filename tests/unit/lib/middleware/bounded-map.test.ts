import { describe, expect, it } from 'vitest'
import { boundMap } from '@/app/lib/middleware/bounded-map'

const expired = (value: { resetTime: number }, now: number) =>
  now > value.resetTime

describe('boundMap', () => {
  it('leaves a map below the ceiling untouched', () => {
    const map = new Map([['a', { resetTime: Date.now() + 60_000 }]])
    boundMap(map, 10, expired)
    expect([...map.keys()]).toEqual(['a'])
  })

  it('sweeps expired entries before evicting', () => {
    const past = { resetTime: Date.now() - 1 }
    const live = { resetTime: Date.now() + 60_000 }
    const map = new Map([
      ['stale-1', past],
      ['stale-2', past],
      ['live', live]
    ])

    boundMap(map, 3, expired)

    expect(map.has('stale-1')).toBe(false)
    expect(map.has('stale-2')).toBe(false)
    expect(map.has('live')).toBe(true)
  })

  it('evicts the oldest key when nothing has expired, enforcing the ceiling', () => {
    const live = { resetTime: Date.now() + 60_000 }
    const map = new Map([
      ['oldest', live],
      ['second', live],
      ['third', live]
    ])

    boundMap(map, 3, expired)

    expect(map.size).toBe(2)
    expect(map.has('oldest')).toBe(false)
    expect(map.has('second')).toBe(true)
  })

  it('stays within the ceiling across a burst of distinct keys', () => {
    const maxEntries = 500
    const map = new Map<string, { resetTime: number }>()
    const live = { resetTime: Date.now() + 60_000 }

    for (let i = 0; i < maxEntries + 250; i++) {
      boundMap(map, maxEntries, expired)
      map.set(`burst-${i}`, live)
    }

    expect(map.size).toBeLessThanOrEqual(maxEntries)
  })
})

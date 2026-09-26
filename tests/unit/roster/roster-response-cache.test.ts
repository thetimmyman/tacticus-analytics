import { beforeEach, describe, expect, it } from 'vitest'
import {
  invalidateCachedRoster,
  readCachedRoster,
  ROSTER_CACHE_MAX_ENTRIES,
  ROSTER_CACHE_TTL_MS,
  writeCachedRoster
} from '@/app/(dashboard)/roster/utils/roster-response-cache'

interface Payload {
  units: string[]
}

describe('member roster response cache', () => {
  beforeEach(() => {
    invalidateCachedRoster()
  })

  it('serves a repeat open inside the TTL without a refetch', () => {
    const t0 = 5_000_000
    writeCachedRoster<Payload>('page', 'p1', { units: ['a'] }, t0)
    expect(
      readCachedRoster<Payload>('page', 'p1', t0 + ROSTER_CACHE_TTL_MS - 1)
    ).toEqual({ units: ['a'] })
  })

  it('uses a 60-second TTL and a 40-entry bound', () => {
    expect(ROSTER_CACHE_TTL_MS).toBe(60_000)
    expect(ROSTER_CACHE_MAX_ENTRIES).toBe(40)
  })

  it('expires so an in-game roster change is picked up', () => {
    const t0 = 5_000_000
    writeCachedRoster<Payload>('page', 'p1', { units: ['a'] }, t0)
    expect(
      readCachedRoster<Payload>('page', 'p1', t0 + ROSTER_CACHE_TTL_MS + 1)
    ).toBeNull()
  })

  it('keys per player so one member never serves another member roster', () => {
    writeCachedRoster<Payload>('page', 'p1', { units: ['a'] })
    expect(readCachedRoster<Payload>('page', 'p2')).toBeNull()
  })

  it('bounds the pool and evicts the least-recently-used entry', () => {
    for (let i = 0; i < ROSTER_CACHE_MAX_ENTRIES; i += 1) {
      writeCachedRoster<Payload>('page', `p${i}`, { units: [`u${i}`] })
    }
    expect(readCachedRoster<Payload>('page', 'p0')).not.toBeNull()

    writeCachedRoster<Payload>('page', 'overflow', { units: ['x'] })

    expect(readCachedRoster<Payload>('page', 'p0')).not.toBeNull()
    expect(readCachedRoster<Payload>('page', 'p1')).toBeNull()
    expect(readCachedRoster<Payload>('page', 'overflow')).not.toBeNull()
  })

  it('invalidates one player across scopes without dropping the rest', () => {
    writeCachedRoster<Payload>('page', 'p1', { units: ['a'] })
    writeCachedRoster<Payload>('modal', 'p1', { units: ['raw'] })
    writeCachedRoster<Payload>('page', 'p2', { units: ['b'] })

    invalidateCachedRoster('p1')

    expect(readCachedRoster<Payload>('page', 'p1')).toBeNull()
    expect(readCachedRoster<Payload>('modal', 'p1')).toBeNull()
    expect(readCachedRoster<Payload>('page', 'p2')).not.toBeNull()
  })

  it('does not serve an entry written for a different scope', () => {
    writeCachedRoster<Payload>('modal', 'p1', { units: ['raw'] })
    expect(readCachedRoster<Payload>('page', 'p1')).toBeNull()
  })

  it('treats a future-dated entry as a miss after a backwards clock jump', () => {
    const t0 = 5_000_000
    writeCachedRoster<Payload>('page', 'p1', { units: ['a'] }, t0)
    expect(readCachedRoster<Payload>('page', 'p1', t0 - 1_000)).toBeNull()
  })
})

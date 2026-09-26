import { describe, expect, it } from 'vitest'
import {
  SYNC_STALE_MS,
  isRosterWitnessStale,
  rosterWitnessAt
} from '@/app/lib/onboarding/roster-freshness'

// MIN lets one unstamped row pin the guild stale; MAX fails as single-row corridors stamp updated_at.

const NOW = Date.parse('2026-09-08T12:00:00.000Z')
const fresh = new Date(NOW - 60 * 60 * 1000).toISOString()
const stale = new Date(NOW - 45 * 24 * 60 * 60 * 1000).toISOString()

const row = (updated_at: string | null, isProtected = false) => ({
  updated_at,
  protected: isProtected
})

describe('rosterWitnessAt', () => {
  it('fails closed when there is no unprotected row to witness with', () => {
    expect(rosterWitnessAt([])).toBeNull()
    expect(rosterWitnessAt([row(fresh, true)])).toBeNull()
    expect(isRosterWitnessStale([], NOW)).toBe(true)
    expect(isRosterWitnessStale([row(fresh, true)], NOW)).toBe(true)
  })

  it('ignores protected rows, which a pass never re-stamps', () => {
    expect(isRosterWitnessStale([row(fresh), row(stale, true)], NOW)).toBe(
      false
    )
  })

  it('survives a MINORITY of never-re-stamped rows', () => {
    const rows = [row(fresh), row(fresh), row(fresh), row(fresh), row(stale)]
    expect(isRosterWitnessStale(rows, NOW)).toBe(false)
  })

  it('is not moved by a MINORITY of freshly-touched rows', () => {
    const rows = [row(fresh), row(stale), row(stale), row(stale), row(stale)]
    expect(isRosterWitnessStale(rows, NOW)).toBe(true)
  })

  it('refuses a roster that is stale across the board', () => {
    expect(
      isRosterWitnessStale([row(stale), row(stale), row(stale)], NOW)
    ).toBe(true)
  })

  it('counts an unparseable stamp as unobserved without letting it decide alone', () => {
    expect(isRosterWitnessStale([row(null)], NOW)).toBe(true)
    expect(isRosterWitnessStale([row('not-a-date')], NOW)).toBe(true)
    expect(isRosterWitnessStale([row(fresh), row(fresh), row(null)], NOW)).toBe(
      false
    )
  })

  it('breaks an even split toward refusing', () => {
    // Lower median: two rows, one fresh one stale, resolves to the stale one.
    expect(isRosterWitnessStale([row(fresh), row(stale)], NOW)).toBe(true)
  })

  it('treats the boundary itself as still fresh', () => {
    const edge = new Date(NOW - SYNC_STALE_MS).toISOString()
    expect(isRosterWitnessStale([row(edge)], NOW)).toBe(false)
    const past = new Date(NOW - SYNC_STALE_MS - 1000).toISOString()
    expect(isRosterWitnessStale([row(past)], NOW)).toBe(true)
  })
})

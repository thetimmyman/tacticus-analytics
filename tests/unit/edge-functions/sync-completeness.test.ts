import { describe, expect, it } from 'vitest'
import {
  isCompleteHistoricalSync,
  isCompleteRaidWrite
} from '../../../supabase/functions/_shared/sync-completeness'

const complete = {
  sourceEntries: 501,
  visitedEntries: 501,
  acceptedEntries: 501,
  upsertedEntries: 501,
  errors: 0,
  seasonValid: true
}
describe('raid persistence completeness', () => {
  it('accepts every acknowledged row and a valid empty season', () => {
    expect(isCompleteRaidWrite(complete)).toBe(true)
    expect(
      isCompleteRaidWrite({
        ...complete,
        sourceEntries: 0,
        visitedEntries: 0,
        acceptedEntries: 0,
        upsertedEntries: 0
      })
    ).toBe(true)
  })
  it.each([
    [
      'timeout between batches',
      { visitedEntries: 500, acceptedEntries: 500, upsertedEntries: 500 }
    ],
    ['transform rejection', { acceptedEntries: 500, upsertedEntries: 500 }],
    ['writer validation rejection', { upsertedEntries: 500, errors: 1 }],
    ['short successful database acknowledgement', { upsertedEntries: 500 }],
    ['single-row retry failure', { errors: 1 }],
    ['unresolved season', { seasonValid: false }],
    ['malformed count', { sourceEntries: NaN }]
  ])('rejects %s instead of advancing sync health', (_reason, change) => {
    expect(isCompleteRaidWrite({ ...complete, ...change })).toBe(false)
  })
})
describe('historical sync acceptance', () => {
  const ok = {
    success: true,
    partial: false,
    season: 106,
    historical: { requestedSeason: 106 },
    stats: {
      totalEntries: 63,
      finalValidEntries: 63,
      processedEntries: 63,
      upsertedEntries: 63,
      errorEntries: 0
    }
  }
  it('accepts an exact fully persisted requested season', () =>
    expect(isCompleteHistoricalSync(ok, 106)).toBe(true))
  it.each([
    ['busy lock', { success: true, skipped: 'sync_in_progress' }],
    ['partial success', { ...ok, partial: true }],
    ['wrong season', { ...ok, season: 110 }],
    ['live-season response', { ...ok, historical: { seasonCount: 10 } }],
    [
      'missing acknowledgement',
      { ...ok, stats: { ...ok.stats, upsertedEntries: 62 } }
    ],
    [
      'transform drops',
      { ...ok, stats: { ...ok.stats, processedEntries: 62 } }
    ],
    ['write error', { ...ok, stats: { ...ok.stats, errorEntries: 1 } }],
    [
      'missing metrics',
      { success: true, season: 106, historical: { requestedSeason: 106 } }
    ]
  ])('refuses %s', (_reason, value) =>
    expect(isCompleteHistoricalSync(value, 106)).toBe(false)
  )
})

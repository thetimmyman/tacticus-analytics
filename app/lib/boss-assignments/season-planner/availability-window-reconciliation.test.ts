import { describe, it, expect } from 'vitest'
import { computeSeasonWindowMs } from '@/app/lib/boss-assignments/season-planner/season-window'

const LIVE = {
  firstSeasonStartMs: 1_646_128_800_000,
  seasonDurationSeconds: 1_209_600,
  bufferAfterSeasonEndSeconds: 86_400,
  seasonNumberOffset: 10
}

function legacyAvailabilityStartMs(seasonNumber: number): number {
  const seasonDurationMs = LIVE.seasonDurationSeconds * 1000
  const seasonsElapsed = seasonNumber + LIVE.seasonNumberOffset - 1
  return LIVE.firstSeasonStartMs + seasonsElapsed * seasonDurationMs
}

describe('season boundary — availability ↔ generate reconciliation', () => {
  it('both routes now share the single computeSeasonWindowMs source', () => {
    for (const season of [99, 103, 110]) {
      const availabilityStart = computeSeasonWindowMs(
        season,
        LIVE
      ).seasonStartMs
      const generateStart = computeSeasonWindowMs(season, LIVE).seasonStartMs
      expect(availabilityStart).toBe(generateStart)
    }
  })

  it('the fixed boundary is exactly one bufferAfterSeasonEnd later than the removed inline math', () => {
    for (const season of [99, 103, 110]) {
      const fixed = computeSeasonWindowMs(season, LIVE).seasonStartMs
      const legacy = legacyAvailabilityStartMs(season)
      expect(fixed - legacy).toBe(LIVE.bufferAfterSeasonEndSeconds * 1000)
      expect(fixed - legacy).toBe(86_400_000) // ~24h
    }
  })
})

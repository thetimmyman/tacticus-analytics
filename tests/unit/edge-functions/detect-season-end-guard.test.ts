import { describe, it, expect } from 'vitest'
import {
  SEASON_SUMMARY_GRACE_MS,
  hasSeasonEnded
} from '../../../supabase/functions/detect-season-end/season-end-guard'

const NOW = Date.parse('2026-07-15T00:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

describe('detect-season-end season-end-guard', () => {
  describe('hasSeasonEnded', () => {
    it('is false with no season_calendar row yet (never guess "ended")', () => {
      expect(hasSeasonEnded(NOW, null)).toBe(false)
      expect(hasSeasonEnded(NOW, undefined)).toBe(false)
    })

    it('is false with an unparseable ends_at', () => {
      expect(hasSeasonEnded(NOW, 'not-a-date')).toBe(false)
    })

    it('is false while ends_at is still in the future', () => {
      expect(hasSeasonEnded(NOW, '2026-07-16T00:00:00Z')).toBe(false)
    })

    it('is false right at ends_at: still inside the grace window for late-syncing battles', () => {
      expect(hasSeasonEnded(NOW, new Date(NOW).toISOString())).toBe(false)
    })

    it('is false just under the grace window after ends_at', () => {
      const endsAt = new Date(
        NOW - SEASON_SUMMARY_GRACE_MS + 1000
      ).toISOString()
      expect(hasSeasonEnded(NOW, endsAt)).toBe(false)
    })

    it('is true once the grace window since ends_at has elapsed', () => {
      const endsAt = new Date(NOW - SEASON_SUMMARY_GRACE_MS).toISOString()
      expect(hasSeasonEnded(NOW, endsAt)).toBe(true)
    })

    it('is true well after ends_at plus grace', () => {
      expect(hasSeasonEnded(NOW, '2026-07-01T00:00:00Z')).toBe(true)
    })

    it('accepts a custom grace window', () => {
      const endsAt = new Date(NOW - DAY_MS).toISOString()
      expect(hasSeasonEnded(NOW, endsAt, 0)).toBe(true)
      expect(hasSeasonEnded(NOW, endsAt, 2 * DAY_MS)).toBe(false)
    })

    it('reproduces the incident this replaces: a cluster whose currentSeason is its own max can never have "next season" rows', () => {
      // The retired check looked for battle rows in currentSeason + 1, where
      // currentSeason was fetched as that cluster's MAX season — by
      // construction there can never be a row past the max, so it never
      // fired. The fix reads a real clock (plus a grace window, like
      // calculate-votlw's own season-guard) instead of an internally
      // contradictory row check.
      const seasonHasEndedByClock = hasSeasonEnded(NOW, '2026-07-01T00:00:00Z')
      expect(seasonHasEndedByClock).toBe(true)
    })
  })
})

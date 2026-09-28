import { describe, it, expect } from 'vitest'
import {
  VOTLW_SEASON_END_GRACE_MS,
  buildGuildSeasonRows,
  selectScorableSeasons,
  type GuildSeasonRow
} from '../../../supabase/functions/calculate-votlw/season-guard.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-07-15T00:00:00Z')

// The pre-fix rule this replaces: one global "latest season - 1", scored for
// every guild that has any row tagged with that season. Kept here only to
// prove the regression the new selector fixes.
function legacyGuildsScoredForGlobalPreviousSeason(
  rows: GuildSeasonRow[],
  globalPreviousSeason: number
): string[] {
  return [
    ...new Set(
      rows.filter((r) => r.season === globalPreviousSeason).map((r) => r.guild)
    )
  ]
}

describe('votlw season-guard', () => {
  describe('selectScorableSeasons', () => {
    it('does not score a season the guild has no later data for', () => {
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, latestBattleMs: NOW - 10 * DAY_MS }
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([])
    })

    it('withholds scoring during the grace window right after the next season is first seen', () => {
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, latestBattleMs: NOW - 14 * DAY_MS },
        { guild: 'GuildA', season: 105, latestBattleMs: NOW - 60 * 1000 } // season 105's newest battle was a minute ago
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([])
    })

    it('scores once the grace window since the next season newest battle has elapsed', () => {
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, latestBattleMs: NOW - 14 * DAY_MS },
        {
          guild: 'GuildA',
          season: 105,
          latestBattleMs: NOW - VOTLW_SEASON_END_GRACE_MS - 1000
        }
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([
        { guild: 'GuildA', season: 104 }
      ])
    })

    it('keeps returning the same pair (recompute/overwrite) while the guild has not moved on again', () => {
      const firstRun: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, latestBattleMs: NOW - 14 * DAY_MS },
        { guild: 'GuildA', season: 105, latestBattleMs: NOW - 2 * DAY_MS }
      ]
      const laterRunWithMoreSeason104Data: GuildSeasonRow[] = [
        ...firstRun,
        { guild: 'GuildA', season: 104, latestBattleMs: NOW - 13 * DAY_MS } // late-synced season 104 battle
      ]
      expect(selectScorableSeasons(firstRun, NOW)).toEqual([
        { guild: 'GuildA', season: 104 }
      ])
      expect(selectScorableSeasons(laterRunWithMoreSeason104Data, NOW)).toEqual(
        [{ guild: 'GuildA', season: 104 }]
      )
    })

    it('stops selecting a season once the guild has moved on two seasons past it', () => {
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, latestBattleMs: NOW - 30 * DAY_MS },
        { guild: 'GuildA', season: 105, latestBattleMs: NOW - 16 * DAY_MS },
        { guild: 'GuildA', season: 106, latestBattleMs: NOW - 2 * DAY_MS }
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([
        { guild: 'GuildA', season: 105 }
      ])
    })

    it('evaluates each guild against its own data, independent of other guilds', () => {
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildSlow', season: 103, latestBattleMs: NOW - 30 * DAY_MS },
        { guild: 'GuildSlow', season: 104, latestBattleMs: NOW - 10 * DAY_MS },
        { guild: 'GuildFast', season: 104, latestBattleMs: NOW - 40 * DAY_MS },
        { guild: 'GuildFast', season: 105, latestBattleMs: NOW - 30 * DAY_MS },
        { guild: 'GuildFast', season: 106, latestBattleMs: NOW - 2 * DAY_MS }
      ]
      // GuildSlow's own season 103 (ended, grace long past) is independent
      // of GuildFast already being two seasons further ahead.
      expect(selectScorableSeasons(rows, NOW)).toEqual([
        { guild: 'GuildFast', season: 105 },
        { guild: 'GuildSlow', season: 103 }
      ])
    })

    it('reproduces the season-104 incident: a fast-moving guild must not force-score a slow guild whose own season just started', () => {
      // GuildSlow's season 104 only just started (newest battle a minute ago).
      // GuildFast, in a different cluster, already raced ahead to season 105,
      // making the OLD global "latest season - 1" equal 104 for everyone.
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildSlow', season: 103, latestBattleMs: NOW - 20 * DAY_MS },
        { guild: 'GuildSlow', season: 104, latestBattleMs: NOW - 60 * 1000 },
        { guild: 'GuildFast', season: 104, latestBattleMs: NOW - 40 * DAY_MS },
        { guild: 'GuildFast', season: 105, latestBattleMs: NOW - 20 * DAY_MS }
      ]
      const globalLatestSeason = Math.max(...rows.map((r) => r.season)) // 105
      const globalPreviousSeason = globalLatestSeason - 1 // 104: the old rule

      // The bug: the old rule scores GuildSlow's season 104 off one minute of data.
      expect(
        legacyGuildsScoredForGlobalPreviousSeason(rows, globalPreviousSeason)
      ).toContain('GuildSlow')

      // The fix: GuildSlow isn't selected until ITS OWN season 104 has ended + grace.
      const fixed = selectScorableSeasons(rows, NOW)
      expect(
        fixed.find((s) => s.guild === 'GuildSlow' && s.season === 104)
      ).toBeUndefined()
      // GuildFast's own, actually-ended season 104 is unaffected.
      expect(fixed).toContainEqual({ guild: 'GuildFast', season: 104 })
    })
  })

  describe('buildGuildSeasonRows', () => {
    it('keeps the latest battle time per (guild, season), preferring completedOn', () => {
      const rows = buildGuildSeasonRows([
        {
          Guild: 'GuildA',
          season_num: 104,
          startedOn: '2026-07-01T00:00:00Z',
          completedOn: '2026-07-01T00:05:00Z'
        },
        {
          Guild: 'GuildA',
          season_num: 104,
          startedOn: '2026-07-03T00:00:00Z',
          completedOn: '2026-07-03T00:05:00Z'
        },
        {
          Guild: 'GuildA',
          season_num: 105,
          startedOn: '2026-07-16T00:00:00Z',
          completedOn: null
        }
      ])
      expect(rows).toEqual([
        {
          guild: 'GuildA',
          season: 104,
          latestBattleMs: Date.parse('2026-07-03T00:05:00Z')
        },
        {
          guild: 'GuildA',
          season: 105,
          latestBattleMs: Date.parse('2026-07-16T00:00:00Z')
        }
      ])
    })

    it('skips rows with no guild, no season, or an unparseable timestamp', () => {
      const rows = buildGuildSeasonRows([
        {
          Guild: null,
          season_num: 104,
          startedOn: '2026-07-01T00:00:00Z',
          completedOn: null
        },
        {
          Guild: 'GuildA',
          season_num: null,
          startedOn: '2026-07-01T00:00:00Z',
          completedOn: null
        },
        {
          Guild: 'GuildA',
          season_num: 104,
          startedOn: null,
          completedOn: null
        },
        {
          Guild: 'GuildA',
          season_num: 104,
          startedOn: 'not-a-date',
          completedOn: null
        }
      ])
      expect(rows).toEqual([])
    })
  })
})

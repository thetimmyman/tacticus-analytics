import { describe, it, expect } from 'vitest'
import {
  VOTLW_SEASON_END_GRACE_MS,
  buildGuildSeasonRows,
  selectScorableSeasons,
  type GuildSeasonRow
} from '../../../supabase/functions/calculate-votlw/season-guard'

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
        { guild: 'GuildA', season: 104, firstBattleMs: NOW - 10 * DAY_MS }
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([])
    })

    it('withholds scoring during the grace window right after the next season is first seen', () => {
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, firstBattleMs: NOW - 14 * DAY_MS },
        { guild: 'GuildA', season: 105, firstBattleMs: NOW - 60 * 1000 } // season 105's first battle was a minute ago
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([])
    })

    it('scores once the grace window since the next season first battle has elapsed', () => {
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, firstBattleMs: NOW - 14 * DAY_MS },
        {
          guild: 'GuildA',
          season: 105,
          firstBattleMs: NOW - VOTLW_SEASON_END_GRACE_MS - 1000
        }
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([
        { guild: 'GuildA', season: 104 }
      ])
    })

    it('scores 24h after the successor season started even while the guild keeps battling in it daily', () => {
      // Grace is gated on the successor season's FIRST battle: a guild that
      // keeps playing it has a constantly-advancing "latest battle", which
      // would never clear a grace window measured from that instead. Runs
      // raw multi-battle rows through buildGuildSeasonRows, as the caller
      // does, rather than a single pre-aggregated row.
      const rawRows = [
        {
          guild_code: 'GuildA',
          season: 105,
          first_battle: new Date(NOW - 25 * 60 * 60 * 1000).toISOString()
        },
        {
          guild_code: 'GuildA',
          season: 105,
          first_battle: new Date(NOW - 6 * 60 * 60 * 1000).toISOString()
        },
        {
          guild_code: 'GuildA',
          season: 105,
          first_battle: new Date(NOW - 1000).toISOString()
        }
      ]
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, firstBattleMs: NOW - 20 * DAY_MS },
        ...buildGuildSeasonRows(rawRows)
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([
        { guild: 'GuildA', season: 104 }
      ])
    })

    it('keeps returning the same pair (recompute/overwrite) while the guild has not moved on again', () => {
      const firstRun: GuildSeasonRow[] = [
        { guild: 'GuildA', season: 104, firstBattleMs: NOW - 14 * DAY_MS },
        { guild: 'GuildA', season: 105, firstBattleMs: NOW - 2 * DAY_MS }
      ]
      const laterRunWithMoreSeason104Data: GuildSeasonRow[] = [
        ...firstRun,
        { guild: 'GuildA', season: 104, firstBattleMs: NOW - 13 * DAY_MS } // late-synced season 104 battle
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
        { guild: 'GuildA', season: 104, firstBattleMs: NOW - 30 * DAY_MS },
        { guild: 'GuildA', season: 105, firstBattleMs: NOW - 16 * DAY_MS },
        { guild: 'GuildA', season: 106, firstBattleMs: NOW - 2 * DAY_MS }
      ]
      expect(selectScorableSeasons(rows, NOW)).toEqual([
        { guild: 'GuildA', season: 105 }
      ])
    })

    it('evaluates each guild against its own data, independent of other guilds', () => {
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildSlow', season: 103, firstBattleMs: NOW - 30 * DAY_MS },
        { guild: 'GuildSlow', season: 104, firstBattleMs: NOW - 10 * DAY_MS },
        { guild: 'GuildFast', season: 104, firstBattleMs: NOW - 40 * DAY_MS },
        { guild: 'GuildFast', season: 105, firstBattleMs: NOW - 30 * DAY_MS },
        { guild: 'GuildFast', season: 106, firstBattleMs: NOW - 2 * DAY_MS }
      ]
      // GuildSlow's own season 103 (ended, grace long past) is independent
      // of GuildFast already being two seasons further ahead.
      expect(selectScorableSeasons(rows, NOW)).toEqual([
        { guild: 'GuildFast', season: 105 },
        { guild: 'GuildSlow', season: 103 }
      ])
    })

    it('reproduces the season-104 incident: a fast-moving guild must not force-score a slow guild whose own season just started', () => {
      // GuildSlow's season 104 only just started (first battle a minute
      // ago). GuildFast, in a different cluster, already raced ahead to
      // season 105, making the OLD global "latest season - 1" equal 104
      // for every guild, including GuildSlow.
      const rows: GuildSeasonRow[] = [
        { guild: 'GuildSlow', season: 103, firstBattleMs: NOW - 20 * DAY_MS },
        { guild: 'GuildSlow', season: 104, firstBattleMs: NOW - 60 * 1000 },
        { guild: 'GuildFast', season: 104, firstBattleMs: NOW - 40 * DAY_MS },
        { guild: 'GuildFast', season: 105, firstBattleMs: NOW - 20 * DAY_MS }
      ]
      const globalLatestSeason = Math.max(...rows.map((r) => r.season)) // 105
      const globalPreviousSeason = globalLatestSeason - 1 // 104: the old rule

      expect(
        legacyGuildsScoredForGlobalPreviousSeason(rows, globalPreviousSeason)
      ).toContain('GuildSlow')

      const fixed = selectScorableSeasons(rows, NOW)
      expect(
        fixed.find((s) => s.guild === 'GuildSlow' && s.season === 104)
      ).toBeUndefined()
      expect(fixed).toContainEqual({ guild: 'GuildFast', season: 104 })
    })
  })

  describe('buildGuildSeasonRows', () => {
    it('normalizes aggregated RPC rows to one entry per (guild, season)', () => {
      const rows = buildGuildSeasonRows([
        {
          guild_code: 'GuildA',
          season: 104,
          first_battle: '2026-07-01T00:05:00Z'
        },
        {
          guild_code: 'GuildA',
          season: 105,
          first_battle: '2026-07-16T00:00:00Z'
        }
      ])
      expect(rows).toEqual([
        {
          guild: 'GuildA',
          season: 104,
          firstBattleMs: Date.parse('2026-07-01T00:05:00Z')
        },
        {
          guild: 'GuildA',
          season: 105,
          firstBattleMs: Date.parse('2026-07-16T00:00:00Z')
        }
      ])
    })

    it('keeps the earliest time if a duplicate (guild, season) row appears', () => {
      const rows = buildGuildSeasonRows([
        {
          guild_code: 'GuildA',
          season: 104,
          first_battle: '2026-07-03T00:00:00Z'
        },
        {
          guild_code: 'GuildA',
          season: 104,
          first_battle: '2026-07-01T00:00:00Z'
        }
      ])
      expect(rows).toEqual([
        {
          guild: 'GuildA',
          season: 104,
          firstBattleMs: Date.parse('2026-07-01T00:00:00Z')
        }
      ])
    })

    it('skips rows with no guild, no season, or an unparseable timestamp', () => {
      const rows = buildGuildSeasonRows([
        { guild_code: null, season: 104, first_battle: '2026-07-01T00:00:00Z' },
        {
          guild_code: 'GuildA',
          season: null,
          first_battle: '2026-07-01T00:00:00Z'
        },
        { guild_code: 'GuildA', season: 104, first_battle: null },
        { guild_code: 'GuildA', season: 104, first_battle: 'not-a-date' }
      ])
      expect(rows).toEqual([])
    })
  })
})

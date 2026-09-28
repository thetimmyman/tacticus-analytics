// Which (guild, season) pairs a scheduled calculate-votlw run should score.
// No Deno imports, so it runs under vitest like votlw-core.ts. Guilds advance
// on independent season calendars, so a single global "latest season - 1" can
// name a season one guild barely started. Score each guild against its OWN
// latest synced season, once VOTLW_SEASON_END_GRACE_MS has passed since that
// season's data first arrived, so late-syncing battles have time to land.
export const VOTLW_SEASON_END_GRACE_MS = 24 * 60 * 60 * 1000

// How many seasons behind the global max to still fetch data for. A guild
// more stale than this is out of scope for the routine run; catching it up
// is a one-off backfill, not something the daily guard should keep paying to
// re-check.
export const VOTLW_LOOKBACK_SEASONS = 6

export type GuildSeasonRow = {
  guild: string
  season: number
  firstSeenMs: number
}

export type ScorableSeason = {
  guild: string
  season: number
}

/** Collapses raw EOT_GR_data rows to one first-synced timestamp per (guild, season). */
export function buildGuildSeasonRows(
  rows: Array<{
    Guild: string | null
    season_num: number | null
    timestamp: string | null
  }>
): GuildSeasonRow[] {
  const firstSeenByKey = new Map<string, GuildSeasonRow>()
  for (const row of rows) {
    if (!row.Guild || row.season_num === null || row.season_num === undefined) {
      continue
    }
    const seenMs = row.timestamp ? Date.parse(row.timestamp) : NaN
    if (!Number.isFinite(seenMs)) continue
    const key = `${row.Guild}|${row.season_num}`
    const existing = firstSeenByKey.get(key)
    if (!existing || seenMs < existing.firstSeenMs) {
      firstSeenByKey.set(key, {
        guild: row.Guild,
        season: row.season_num,
        firstSeenMs: seenMs
      })
    }
  }
  return [...firstSeenByKey.values()]
}

/**
 * Picks each guild's most recently completed season: one whose successor
 * season has data (proof the guild moved on) once the grace window since
 * that successor's first row has elapsed. Re-running with the same inputs
 * (or with more rows added by later syncs) keeps returning the same pair
 * until the guild moves on again, so the caller's upsert naturally
 * recomputes/overwrites a season's winner as late data lands.
 */
export function selectScorableSeasons(
  rows: GuildSeasonRow[],
  nowMs: number,
  graceMs: number = VOTLW_SEASON_END_GRACE_MS
): ScorableSeason[] {
  const byGuild = new Map<string, Map<number, GuildSeasonRow>>()
  for (const row of rows) {
    let seasons = byGuild.get(row.guild)
    if (!seasons) {
      seasons = new Map()
      byGuild.set(row.guild, seasons)
    }
    const existing = seasons.get(row.season)
    if (!existing || row.firstSeenMs < existing.firstSeenMs) {
      seasons.set(row.season, row)
    }
  }

  const result: ScorableSeason[] = []
  for (const [guild, seasons] of byGuild) {
    const latestSeason = Math.max(...seasons.keys())
    const latestRow = seasons.get(latestSeason)
    if (!latestRow) continue
    const previousSeason = latestSeason - 1
    if (!seasons.has(previousSeason)) continue // nothing synced for that season at all
    if (nowMs - latestRow.firstSeenMs < graceMs) continue // still inside the grace window
    result.push({ guild, season: previousSeason })
  }
  return result.sort(
    (a, b) => a.guild.localeCompare(b.guild) || a.season - b.season
  )
}

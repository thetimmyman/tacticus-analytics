// Which (guild, season) pairs a scheduled calculate-votlw run should score.
// No Deno imports, so it runs under vitest like votlw-core.ts. A single
// global "latest season - 1" can name a season one guild barely started, so
// score each guild against its OWN latest season, once VOTLW_SEASON_END_GRACE_MS
// has passed (battle-clock time) since that season's FIRST known battle —
// not its most recent one, which stays "recent" for as long as the guild
// keeps playing and would never satisfy the grace window.
export const VOTLW_SEASON_END_GRACE_MS = 24 * 60 * 60 * 1000

// How many seasons behind the global max to still fetch data for. A guild
// more stale than this is out of scope for the routine run; catching it up
// is a one-off backfill, not something the daily guard should keep paying to
// re-check.
export const VOTLW_LOOKBACK_SEASONS = 6

export type GuildSeasonRow = {
  guild: string
  season: number
  firstBattleMs: number
}

export type ScorableSeason = {
  guild: string
  season: number
}

/**
 * Normalizes rows from the get_votlw_guild_season_first_battle RPC (already
 * one row per (guild, season) — the RPC aggregates server-side so the caller
 * never pages raw EOT_GR_data past PostgREST's row cap). Still collapses any
 * accidental duplicates to the earliest time, defensively.
 */
export function buildGuildSeasonRows(
  rows: Array<{
    guild_code: string | null
    season: number | null
    first_battle: string | null
  }>
): GuildSeasonRow[] {
  const earliestByKey = new Map<string, GuildSeasonRow>()
  for (const row of rows) {
    if (!row.guild_code || row.season === null || row.season === undefined) {
      continue
    }
    const battleMs = row.first_battle ? Date.parse(row.first_battle) : NaN
    if (!Number.isFinite(battleMs)) continue
    const key = `${row.guild_code}|${row.season}`
    const existing = earliestByKey.get(key)
    if (!existing || battleMs < existing.firstBattleMs) {
      earliestByKey.set(key, {
        guild: row.guild_code,
        season: row.season,
        firstBattleMs: battleMs
      })
    }
  }
  return [...earliestByKey.values()]
}

/**
 * Picks each guild's most recently completed season: one whose successor
 * season has data (proof the guild moved on) once the grace window since
 * that successor's first battle has elapsed. Re-running with the same
 * inputs (or with more rows added by later syncs) keeps returning the same
 * pair until the guild moves on again, so the caller's upsert naturally
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
    if (!existing || row.firstBattleMs < existing.firstBattleMs) {
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
    if (nowMs - latestRow.firstBattleMs < graceMs) continue // still inside the grace window
    result.push({ guild, season: previousSeason })
  }
  return result.sort(
    (a, b) => a.guild.localeCompare(b.guild) || a.season - b.season
  )
}

export type ManualSeasonResult = { season: string } | { error: string } | null

/**
 * Validates a manually-supplied `season` body field. Returns null when none
 * was supplied (caller falls back to the guild-only or scheduled path), an
 * `error` when one was supplied but is not usable, or the trimmed value
 * unchanged otherwise — callers pass this same string on to guild discovery,
 * both award RPCs, and the upsert, rather than parseInt-then-toString it
 * (which turns a non-numeric or empty value into a silently wrong "NaN" row).
 */
export function normalizeManualSeason(raw: unknown): ManualSeasonResult {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') {
    return { error: `season must be a string, got ${typeof raw}` }
  }
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    return {
      error: `season must match ^\\d+$ after trimming, got ${JSON.stringify(raw)}`
    }
  }
  if (Number(trimmed) === 0) {
    return { error: 'season 0 is not valid' }
  }
  return { season: trimmed }
}

/**
 * A manual call naming only a guild (calculate_votlw_for_season(NULL, guild))
 * scores that guild's own previous season directly, from its own latest
 * season — no grace window, since an explicit manual call already knows what
 * it wants scored. latestSeasonForGuild is get_latest_season_for_guild's
 * result (MAX(season_num)::text, or null with no data for the guild).
 */
export function computeManualGuildTarget(
  guild: string,
  latestSeasonForGuild: string | null
): ScorableSeason | null {
  if (!latestSeasonForGuild) return null
  const latest = Number(latestSeasonForGuild)
  if (!Number.isFinite(latest)) return null
  const previous = latest - 1
  if (previous < 1) return null
  return { guild, season: previous }
}

/**
 * Which seasons a calculate-votlw run actually wrote a winner row for. The
 * caller uses this only to decide whether ANY downstream refresh is needed
 * (non-empty), not to refresh per season — see index.ts for why. Non-numeric
 * season strings (should not happen; defensive) are dropped rather than
 * thrown.
 */
export function seasonsWithWrittenWinners(
  results: Array<{ season: string; written: boolean }>
): number[] {
  const seasons = new Set<number>()
  for (const result of results) {
    if (!result.written) continue
    const seasonNum = Number(result.season)
    if (Number.isFinite(seasonNum)) seasons.add(seasonNum)
  }
  return [...seasons].sort((a, b) => a - b)
}

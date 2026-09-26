/** `season_number = ''` is the legacy cross-season fallback; readers prefer the season row. */

export const LEGACY_SEASON = ''

export interface SeasonScopedRow {
  season_number?: string | null
}

export function normalizeSeasonNumber(
  season: number | string | null | undefined
): string {
  if (season === null || season === undefined) return LEGACY_SEASON
  return String(season)
}

/** Null for empty/legacy and malformed values. */
export function parseSeasonParam(season: unknown): string | null {
  if (season === null || season === undefined || season === LEGACY_SEASON) {
    return null
  }
  const seasonString = String(season).trim()
  if (seasonString === LEGACY_SEASON) return null
  const seasonNumber = Number.parseInt(seasonString, 10)
  if (
    !/^\d{1,6}$/.test(seasonString) ||
    !Number.isFinite(seasonNumber) ||
    seasonNumber <= 0
  ) {
    return null
  }
  return String(seasonNumber)
}

/** The season row beats the `''` row regardless of order; other seasons are dropped. */
export function selectSeasonScoped<T extends SeasonScopedRow>(
  rows: readonly T[],
  season: string,
  keyOf: (row: T) => string
): Map<string, T> {
  const out = new Map<string, T>()
  for (const row of rows) {
    const rowSeason = normalizeSeasonNumber(row.season_number)
    if (rowSeason !== season && rowSeason !== LEGACY_SEASON) continue
    const key = keyOf(row)
    const existing = out.get(key)
    if (existing === undefined) {
      out.set(key, row)
      continue
    }
    const existingSeason = normalizeSeasonNumber(existing.season_number)
    if (existingSeason === LEGACY_SEASON && rowSeason === season) {
      out.set(key, row)
    }
  }
  return out
}

/** The seeder's no-data sentinel: never an officer skip, never a performance target. */
export function isTargetNoDataSentinel(
  source: string | null | undefined,
  seededFromSeasons: string | null | undefined
): boolean {
  return (
    source === 'historical_seed' &&
    typeof seededFromSeasons === 'string' &&
    /none available/i.test(seededFromSeasons)
  )
}

export function isOfficerSkip(row: {
  skip?: boolean | null
  source?: string | null
  seeded_from_seasons?: string | null
}): boolean {
  if (row.skip !== true) return false
  return !isTargetNoDataSentinel(row.source, row.seeded_from_seasons)
}

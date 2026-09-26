// `last_successful_sync` is a raid clock, so the roster is dated from its rows' `updated_at`.

export const SYNC_STALE_MS = 30 * 24 * 60 * 60 * 1000

export interface RosterFreshnessRow {
  updated_at: string | null
  protected: boolean | null
}

/** Lower median of unprotected rows' stamps: min never recovers from stragglers and max is forgeable
 * by one API-key save. Protected rows are never re-stamped, so excluded; unparseable = -Infinity.
 * Null when no unprotected row exists; callers must fail closed. */
export function rosterWitnessAt(
  rows: readonly RosterFreshnessRow[]
): number | null {
  const stamps = rows
    .filter((row) => row.protected !== true)
    .map((row) => {
      const stamp = Date.parse(row.updated_at ?? '')
      return Number.isNaN(stamp) ? Number.NEGATIVE_INFINITY : stamp
    })
    .sort((first, second) => first - second)

  if (stamps.length === 0) return null
  return stamps[Math.floor((stamps.length - 1) / 2)] as number
}

/** Split out so the leader corridor gates on exactly the stamp it seals into evidence. */
export function isWitnessStale(
  observedAt: number | null,
  now: number = Date.now()
): boolean {
  return observedAt === null || now - observedAt > SYNC_STALE_MS
}

export function isRosterWitnessStale(
  rows: readonly RosterFreshnessRow[],
  now: number = Date.now()
): boolean {
  return isWitnessStale(rosterWitnessAt(rows), now)
}

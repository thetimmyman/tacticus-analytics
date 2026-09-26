/**
 * Guild War season calendar, in core so the leaderboard probe can use it. Mirror of
 * supabase/functions/_shared/gw-season.ts; ground truth is the in-game UI.
 */

/** In-game season number for {@link GW_SEASON_ANCHOR_START_MS}, confirmed from the game UI. */
export const GW_SEASON_ANCHOR_SEASON = 25
export const GW_SEASON_ANCHOR_START_MS = Date.parse('2026-07-08T09:00:00Z')
export const GW_SEASON_CADENCE_MS = 35 * 24 * 60 * 60 * 1000

export const GW_WAR_SLOT_OFFSETS_MS = [0, 4.5, 7, 9.5, 12, 14.5].map(
  (days) => days * 24 * 60 * 60 * 1000
)

/** Earlier dates predate any observation of the cadence. */
export const GW_SEASON_MIN_START_MS =
  GW_SEASON_ANCHOR_START_MS - 4 * GW_SEASON_CADENCE_MS - 24 * 60 * 60 * 1000

/** Seeds the leaderboard probe from the real current season, not a literal that rots. */
export const currentGwSeason = (nowMs: number = Date.now()): number =>
  GW_SEASON_ANCHOR_SEASON +
  Math.floor((nowMs - GW_SEASON_ANCHOR_START_MS) / GW_SEASON_CADENCE_MS)

/**
 * `warNumber` snaps to the nearest slot, tolerating `war_start_date` lagging
 * up to ~13h (it is often the first logged action). Season 0 before the corpus.
 */
export const computeSeasonAndWarNumberFromStart = (
  startMs: number | undefined
): { season: number; warNumber?: number } => {
  if (
    typeof startMs !== 'number' ||
    !Number.isFinite(startMs) ||
    startMs < GW_SEASON_MIN_START_MS
  ) {
    return { season: 0, warNumber: undefined }
  }
  // 6h grace for a slot-time start just before the computed boundary.
  const GRACE_MS = 6 * 60 * 60 * 1000
  const sinceAnchor = startMs - GW_SEASON_ANCHOR_START_MS
  const seasonIndex = Math.floor(
    (sinceAnchor + GRACE_MS) / GW_SEASON_CADENCE_MS
  )
  const season = GW_SEASON_ANCHOR_SEASON + seasonIndex
  const seasonStartMs =
    GW_SEASON_ANCHOR_START_MS + seasonIndex * GW_SEASON_CADENCE_MS
  const offsetMs = startMs - seasonStartMs
  let warNumber = 1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < GW_WAR_SLOT_OFFSETS_MS.length; i++) {
    const distance = Math.abs(offsetMs - GW_WAR_SLOT_OFFSETS_MS[i]!)
    if (distance < bestDistance) {
      bestDistance = distance
      warNumber = i + 1
    }
  }
  return { season, warNumber }
}

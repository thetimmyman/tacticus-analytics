/**
 * Guild War season calendar (edge cannot import the app copy). Never anchor on
 * guild_config.last_successful_gw_season: it is a per-guild ratchet, not the live season.
 */

/** The in-game Guild War season number for {@link GW_SEASON_ANCHOR_START_MS}. */
const GW_SEASON_ANCHOR_SEASON = 25
const GW_SEASON_ANCHOR_START_MS = Date.parse('2026-07-08T09:00:00Z')
const GW_SEASON_CADENCE_MS = 35 * 24 * 60 * 60 * 1000
/** War-start offsets from the season start, in days: wars 1-6. */
export const GW_WAR_SLOT_OFFSETS_MS = [0, 4.5, 7, 9.5, 12, 14.5].map(
  (days) => days * 24 * 60 * 60 * 1000
)
export const GW_SEASON_MIN_START_MS =
  GW_SEASON_ANCHOR_START_MS - 4 * GW_SEASON_CADENCE_MS - 24 * 60 * 60 * 1000

/** Season in progress at `nowMs`; seeds the leaderboard probe for uncached guilds. */
export const currentGwSeason = (nowMs: number = Date.now()): number =>
  GW_SEASON_ANCHOR_SEASON +
  Math.floor((nowMs - GW_SEASON_ANCHOR_START_MS) / GW_SEASON_CADENCE_MS)

/** `warNumber` snaps to the nearest of the six slot offsets. */
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
  // 6h grace: a slot-time start just before the boundary stays in its season.
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

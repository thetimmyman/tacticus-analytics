/** Must stay byte-identical to computeFromConstants() in season-timing-service. */

export interface SeasonWindowMs {
  seasonStartMs: number
  seasonEndMs: number
}

export interface SeasonWindowConstants {
  /** LOKI `firstSeasonStart` (ms): the instant BEFORE the first season. */
  firstSeasonStartMs: number
  seasonDurationSeconds: number
  bufferAfterSeasonEndSeconds: number
  seasonNumberOffset: number
}

/** The start MUST add the `bufferAfterSeasonEnd` gap, or every boundary shifts 24h early. */
export function computeSeasonWindowMs(
  seasonNumber: number,
  constants: SeasonWindowConstants
): SeasonWindowMs {
  const cycleMs = constants.seasonDurationSeconds * 1000
  const gapMs = constants.bufferAfterSeasonEndSeconds * 1000
  const activeMs = Math.max(0, cycleMs - gapMs)
  const seasonsElapsed = seasonNumber + constants.seasonNumberOffset - 1
  const seasonStartMs =
    constants.firstSeasonStartMs + gapMs + seasonsElapsed * cycleMs
  const seasonEndMs = seasonStartMs + activeMs
  return { seasonStartMs, seasonEndMs }
}

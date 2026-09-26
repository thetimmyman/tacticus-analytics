/** Season cache TTLs in seconds; SeasonSelector's 5m staleTime is deliberately not coupled. */

// Closed seasons are immutable; one day still allows recovery from backfills.
export const CLOSED_SEASON_TTL_SECONDS = 24 * 60 * 60 // 24h

export const CURRENT_SEASON_TTL_SECONDS = 5 * 60 // 5m

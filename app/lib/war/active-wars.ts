import { TOTAL_WAR_DURATION_MS } from './timing/constants'

export const ACTIVE_WAR_VISIBILITY_GRACE_MS = 12 * 60 * 60 * 1000

// Loki sometimes omits endsOn during prep; such wars stay visible for one full
// war duration plus the grace window after war_start_date.
export const ACTIVE_WAR_NULL_END_GRACE_MS =
  TOTAL_WAR_DURATION_MS + ACTIVE_WAR_VISIBILITY_GRACE_MS

export function getActiveWarVisibilityCutoffIso(
  nowMs: number = Date.now()
): string {
  return new Date(nowMs - ACTIVE_WAR_VISIBILITY_GRACE_MS).toISOString()
}

export function getActiveWarNullEndCutoffIso(
  nowMs: number = Date.now()
): string {
  return new Date(nowMs - ACTIVE_WAR_NULL_END_GRACE_MS).toISOString()
}

export function buildActiveWarVisibilityFilter(
  nowMs: number = Date.now()
): string {
  const endCutoff = getActiveWarVisibilityCutoffIso(nowMs)
  const startCutoff = getActiveWarNullEndCutoffIso(nowMs)
  return `war_end_date.gt.${endCutoff},and(war_end_date.is.null,war_start_date.gt.${startCutoff})`
}

/**
 * FROZEN COPY of the original token-only decision core. DO NOT EDIT, REFACTOR OR "FIX".
 * Differential-test oracle: `decideAlerts` must agree on every token-only input; a
 * mismatch is a regression in the new code. Verbatim apart from local types and export name.
 */

import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'
import type {
  UserTokenAlertPrefs,
  UserTokenAlertState
} from '@/app/lib/token-alerts/types'

type TokenAlertType = 'full' | 'prewarn' | 'gained'

export interface V0Input {
  now: Date
  prefs: UserTokenAlertPrefs
  state: UserTokenAlertState | null
  tokens: number
  tokenNextInSeconds: number | null
}

export interface V0Result {
  alerts: TokenAlertType[]
  observed: { tokens: number; timeToFullSeconds: number | null }
}

const V0_FULL_REALERT_MS = 11 * 60 * 60 * 1000
const V0_PREWARN_REALERT_MS = 6 * 60 * 60 * 1000
const V0_GAIN_REALERT_MS = 55 * 60 * 1000

function elapsedAtLeast(now: Date, since: string | null, ms: number): boolean {
  if (since == null) return true
  const sinceMs = Date.parse(since)
  if (!Number.isFinite(sinceMs)) return true
  return now.getTime() - sinceMs >= ms
}

export function computeTimeToFullSecondsV0(
  tokens: number,
  tokenNextInSeconds: number | null
): number | null {
  if (tokens >= MAX_TOKENS) return 0
  if (tokenNextInSeconds == null) return null
  return (
    tokenNextInSeconds + (MAX_TOKENS - tokens - 1) * TWELVE_HOURS_IN_SECONDS
  )
}

export function decideAlertsV0({
  now,
  prefs,
  state,
  tokens,
  tokenNextInSeconds
}: V0Input): V0Result {
  const invalid =
    tokens < 0 || (tokenNextInSeconds != null && tokenNextInSeconds < 0)

  const safeTokens = Math.min(Math.max(tokens, 0), MAX_TOKENS)
  const safeNext =
    tokenNextInSeconds == null ? null : Math.max(tokenNextInSeconds, 0)
  const timeToFullSeconds = computeTimeToFullSecondsV0(safeTokens, safeNext)
  const observed = { tokens: safeTokens, timeToFullSeconds }

  if (invalid) {
    return { alerts: [], observed }
  }

  const full =
    prefs.alert_on_full &&
    safeTokens >= MAX_TOKENS &&
    (state?.last_tokens == null || state.last_tokens < MAX_TOKENS) &&
    elapsedAtLeast(now, state?.last_full_alert_at ?? null, V0_FULL_REALERT_MS)

  const windowSeconds = prefs.alert_before_full_minutes * 60
  const prewarn =
    prefs.alert_before_full &&
    safeTokens < MAX_TOKENS &&
    timeToFullSeconds != null &&
    timeToFullSeconds > 0 &&
    timeToFullSeconds <= windowSeconds &&
    (state?.last_time_to_full_seconds == null ||
      state.last_time_to_full_seconds === 0 ||
      state.last_time_to_full_seconds > windowSeconds) &&
    elapsedAtLeast(
      now,
      state?.last_prewarn_alert_at ?? null,
      V0_PREWARN_REALERT_MS
    )

  const gained =
    prefs.alert_on_token_gained &&
    state?.last_tokens != null &&
    safeTokens > state.last_tokens &&
    elapsedAtLeast(now, state?.last_gain_alert_at ?? null, V0_GAIN_REALERT_MS)

  const alerts: TokenAlertType[] = []
  if (full) alerts.push('full')
  else if (prewarn) alerts.push('prewarn')
  else if (gained) alerts.push('gained')

  return { alerts, observed }
}

'use client'

/**
 * Eligibility and dismissal for the token-alert nudge. Conservative: ineligible on fetch
 * failure, feature unavailable, any DM toggle already on, or `dmBlocked`.
 */

import { useCallback, useEffect, useState } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'

const logger = createComponentLogger('token-usage.useTokenAlertNudge')

/** `-v2` so old session-scoped values are not read as permanent dismissals. */
export const TOKEN_ALERT_NUDGE_DISMISSAL_KEY =
  'wi4000:token-alert-nudge-dismissed-v2'

interface TokenAlertPrefs {
  alert_on_full: boolean
  alert_before_full: boolean
  alert_before_full_minutes: number
  alert_on_token_gained: boolean
  /** Optional for older responses; absent = not enabled. */
  alert_on_bomb_ready?: boolean
  alert_before_bomb_ready?: boolean
}

interface TokenAlertsResponse {
  available: boolean
  linked?: boolean
  dmBlocked?: boolean
  prefs?: TokenAlertPrefs
}

/**
 * Opted into at least one DM. Must match the scan's opt-in filter and the pg_cron
 * guard; quiet-hours fields suppress rather than enable, so they are excluded.
 */
function hasAnyAlertEnabled(prefs: TokenAlertPrefs | undefined): boolean {
  if (!prefs) return false
  return Boolean(
    prefs.alert_on_full ||
    prefs.alert_before_full ||
    prefs.alert_on_token_gained ||
    prefs.alert_on_bomb_ready ||
    prefs.alert_before_bomb_ready
  )
}

export interface TokenAlertNudgeState {
  eligible: boolean
  linked: boolean
  dismissed: boolean
  dismiss: () => void
}

export interface UseTokenAlertNudgeOptions {
  /**
   * When false the hook resets its state (BriefingPage flips `enabled` via a URL
   * param without remounting). Pass false rather than skipping the call.
   */
  enabled?: boolean
}

export function useTokenAlertNudge({
  enabled = true
}: UseTokenAlertNudgeOptions = {}): TokenAlertNudgeState {
  const [dismissed, setDismissed] = useState(false)
  const [eligible, setEligible] = useState(false)
  const [linked, setLinked] = useState(false)

  useEffect(() => {
    if (!enabled) {
      // Reset, not just return: `enabled` can flip on a live instance.
      setDismissed(false)
      return
    }
    try {
      // Hydration-safe one-time localStorage read on mount.
      setDismissed(
        window.localStorage.getItem(TOKEN_ALERT_NUDGE_DISMISSAL_KEY) === '1'
      )
    } catch {
      setDismissed(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      // Reset for the same reason as the dismissal effect.
      setEligible(false)
      setLinked(false)
      return
    }
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch('/api/user/token-alerts')
        const data: TokenAlertsResponse = await res.json()
        if (cancelled) return

        if (
          !res.ok ||
          !data.available ||
          data.dmBlocked ||
          hasAnyAlertEnabled(data.prefs)
        ) {
          setEligible(false)
          return
        }

        setLinked(Boolean(data.linked))
        setEligible(true)
      } catch (err) {
        if (cancelled) return
        logger.warn(
          `Failed to load token alert state for nudge: ${err instanceof Error ? err.message : String(err)}`
        )
        setEligible(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [enabled])

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(TOKEN_ALERT_NUDGE_DISMISSAL_KEY, '1')
    } catch {
      // localStorage unavailable: dismiss for this render only.
    }
    setDismissed(true)
  }, [])

  return { eligible, linked, dismissed, dismiss }
}

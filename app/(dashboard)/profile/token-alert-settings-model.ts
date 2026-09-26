import {
  DEFAULT_TOKEN_ALERT_PREFS,
  type TokenAlertPrefs
} from '@/app/lib/token-alerts/preferences-defaults'

export {
  DEFAULT_TOKEN_ALERT_PREFS,
  type TokenAlertPrefs
} from '@/app/lib/token-alerts/preferences-defaults'

export interface TokenAlertsResponse {
  available: boolean
  linked?: boolean
  dmBlocked?: boolean
  /** Explicit `false` swaps in a setup CTA (bot DMs need a shared server); omitted = installed. */
  botInstalled?: boolean
  canSetupBot?: boolean
  prefs?: TokenAlertPrefs
  error?: { message?: string }
}

/** Opt-in defaults for quiet hours: 10pm - 7am. */
export const DEFAULT_QUIET_START = 22
export const DEFAULT_QUIET_END = 7

export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** Compares over DEFAULT_TOKEN_ALERT_PREFS keys so new fields cannot fall out of the dirty check. */
export function tokenAlertPrefsEqual(a: TokenAlertPrefs, b: TokenAlertPrefs) {
  return (
    Object.keys(DEFAULT_TOKEN_ALERT_PREFS) as (keyof TokenAlertPrefs)[]
  ).every((key) => a[key] === b[key])
}

export function updateBombAlertGroup(
  draft: TokenAlertPrefs,
  enabled: boolean
): TokenAlertPrefs {
  return {
    ...draft,
    // Turning the group off must clear BOTH, or a hidden sub-toggle keeps sending DMs.
    alert_on_bomb_ready: enabled,
    alert_before_bomb_ready: enabled ? draft.alert_before_bomb_ready : false
  }
}

export function updateQuietHours(
  draft: TokenAlertPrefs,
  enabled: boolean,
  detectedTimeZone: string | null
): TokenAlertPrefs {
  return {
    ...draft,
    quiet_hours_start: enabled ? DEFAULT_QUIET_START : null,
    quiet_hours_end: enabled ? DEFAULT_QUIET_END : null,
    // All three move together: the DB CHECK forbids a partial triple.
    quiet_hours_timezone: enabled
      ? (draft.quiet_hours_timezone ?? detectedTimeZone)
      : null,
    // A DB CHECK forbids the pre-quiet warning without quiet hours; clear it rather than 400.
    alert_before_quiet_hours: enabled ? draft.alert_before_quiet_hours : false
  }
}

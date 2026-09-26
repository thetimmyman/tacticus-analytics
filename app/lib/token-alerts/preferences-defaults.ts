// Shared by the API route and the profile UI; keep free of server-only imports.
export interface TokenAlertPrefs {
  alert_on_full: boolean
  alert_on_full_repeat_hours: number | null
  alert_before_full: boolean
  alert_before_full_minutes: number
  alert_on_token_gained: boolean
  alert_on_bomb_ready: boolean
  alert_before_bomb_ready: boolean
  alert_before_bomb_ready_minutes: number
  quiet_hours_start: number | null
  quiet_hours_end: number | null
  quiet_hours_timezone: string | null
  alert_before_quiet_hours: boolean
  alert_before_quiet_hours_minutes: number
  alert_before_burn: boolean
  alert_before_burn_minutes: number
}

/** Server merge and client dirty-check iterate these keys: keep a complete TokenAlertPrefs literal. */
export const DEFAULT_TOKEN_ALERT_PREFS: TokenAlertPrefs = {
  alert_on_full: false,
  alert_on_full_repeat_hours: null,
  alert_before_full: false,
  alert_before_full_minutes: 120,
  alert_on_token_gained: false,
  alert_on_bomb_ready: false,
  alert_before_bomb_ready: false,
  alert_before_bomb_ready_minutes: 120,
  quiet_hours_start: null,
  quiet_hours_end: null,
  quiet_hours_timezone: null,
  alert_before_quiet_hours: false,
  alert_before_quiet_hours_minutes: 30,
  alert_before_burn: false,
  alert_before_burn_minutes: 30
}

// Row shapes mirror user_token_alert_prefs / user_token_alert_state; keep in sync with the schema.

import type { AlertType } from '@/app/lib/token-alerts/decision-core'

export type TokenAlertType = 'full' | 'prewarn' | 'gained'

export interface UserTokenAlertPrefs {
  user_id: string
  alert_on_full: boolean
  /** NULL disables; DB requires alert_on_full=true when set. */
  alert_on_full_repeat_hours: number | null
  alert_before_full: boolean
  /** DB CHECK 15..720. */
  alert_before_full_minutes: number
  alert_on_token_gained: boolean

  /** MAX_BOMBS is 1, so bomb "full" and "gained" are the same event. */
  alert_on_bomb_ready: boolean
  alert_before_bomb_ready: boolean
  /** DB CHECK 15..960. */
  alert_before_bomb_ready_minutes: number
  /** Whole local hours 0..23; all three quiet-hours fields are NULL or set together. */
  quiet_hours_start: number | null
  quiet_hours_end: number | null
  quiet_hours_timezone: string | null

  alert_before_quiet_hours: boolean
  /** DB CHECK 15..180. */
  alert_before_quiet_hours_minutes: number
  alert_before_burn: boolean
  /** DB CHECK 15..360. */
  alert_before_burn_minutes: number
}

export interface UserTokenAlertState {
  user_id: string
  last_tokens: number | null
  last_time_to_full_seconds: number | null
  last_scan_at: string | null
  last_full_alert_at: string | null
  last_prewarn_alert_at: string | null
  last_gain_alert_at: string | null
  consecutive_dm_failures: number
  dm_blocked_at: string | null
  dm_channel_id: string | null
  /** Guards against DMing a previously linked account after relink. */
  dm_channel_recipient_id: string | null

  /** Bomb fields are separate so neither alert consumes the other's guard. */
  last_bombs: number | null
  last_time_to_bomb_seconds: number | null
  last_bomb_ready_alert_at: string | null
  last_bomb_prewarn_alert_at: string | null
  quiet_hours_deferred_since: string | null

  /** Burns land at capped_since + 12h*k. NULL (unobserved) sends nothing rather than guessing. */
  capped_since: string | null
  last_pre_quiet_alert_at: string | null
  last_burn_prewarn_alert_at: string | null
}

export interface ObservedTokenState {
  tokens: number
  timeToFullSeconds: number | null
}

export interface UserTokenAlertScanSummary {
  scannedUsers: number
  alertsSent: number
  byType: Record<AlertType, number>
  dmBlocked: number
  rateLimited: number
  errors: number
  deadlineStopped?: boolean

  quietHoursDeferred: number
  quietHoursDropped: number
  /** Forced through by the max-defer valve (window suppressing over a day). */
  quietHoursMaxDeferOverrides: number
  quietHoursConfigErrors: number
  bombReadingsUntrusted: number
}

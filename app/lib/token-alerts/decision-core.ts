// Pure decision core: at most one alert per user per tick (scan.ts does I/O). ALERT_PRECEDENCE is a
// ranking, not a veto: a disqualified higher alert does not suppress a lower one.

import { MAX_BOMBS } from '@/app/lib/calculations/bomb-availability'
import {
  EIGHTEEN_HOURS_IN_SECONDS,
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'
import type { ObservedTokenState } from '@/app/lib/token-alerts/types'

type TokenAlertKind = 'full' | 'prewarn' | 'gained'
type BombAlertKind = 'bomb_ready' | 'bomb_prewarn'
export type ScheduleAlertKind = 'pre_quiet' | 'burn_prewarn'
export type AlertType = TokenAlertKind | BombAlertKind | ScheduleAlertKind

export type ResourceKey = 'token' | 'bomb'

/** Highest first; schedule kinds lead because only they have a deadline. */
export const ALERT_PRECEDENCE: readonly AlertType[] = [
  'pre_quiet',
  'burn_prewarn',
  'full',
  'prewarn',
  'gained',
  'bomb_ready',
  'bomb_prewarn'
] as const

/** Schedule kinds MUST be 'none': a delivered alert advances its resource's baseline, so mapping
 * pre_quiet to 'token' would permanently disarm a same-tick `full` that lost precedence. */
export const ALERT_RESOURCE: Readonly<Record<AlertType, ResourceKey | 'none'>> =
  {
    full: 'token',
    prewarn: 'token',
    gained: 'token',
    bomb_ready: 'bomb',
    bomb_prewarn: 'bomb',
    pre_quiet: 'none',
    burn_prewarn: 'none'
  }

const HOUR_MS = 60 * 60 * 1000

/** Regen minus an hour: long enough that a projection flap cannot double-DM, short enough to catch the next cap-crossing. */
export function fullRealertMsFor(regenSeconds: number): number {
  return regenSeconds * 1000 - HOUR_MS
}

export function prewarnRealertMsFor(regenSeconds: number): number {
  return (regenSeconds * 1000) / 2
}

export const FULL_REALERT_MS = fullRealertMsFor(TWELVE_HOURS_IN_SECONDS)
export const PREWARN_REALERT_MS = prewarnRealertMsFor(TWELVE_HOURS_IN_SECONDS)
export const BOMB_READY_REALERT_MS = fullRealertMsFor(EIGHTEEN_HOURS_IN_SECONDS)
export const BOMB_PREWARN_REALERT_MS = prewarnRealertMsFor(
  EIGHTEEN_HOURS_IN_SECONDS
)

/** Derived from sync cadence, not regen. */
export const GAIN_REALERT_MS = 55 * 60 * 1000

/** Mirror the `user_token_alert_prefs` DB CHECKs. The token ceiling (= regen) works only via the
 * at-cap-0 escape; the bomb ceiling is below regen, else the pre-warning is true right after spending. */
export const MAX_TOKEN_PREWARN_MINUTES = TWELVE_HOURS_IN_SECONDS / 60
export const MAX_BOMB_PREWARN_MINUTES = 960

const DEFAULT_PREWARN_MINUTES = 120

const MIN_FULL_REPEAT_HOURS = 11
const MAX_FULL_REPEAT_HOURS = 168

export const TOKEN_BURN_PERIOD_SECONDS = TWELVE_HOURS_IN_SECONDS

// MIN/MAX lead bounds mirror the DB CHECKs and the settings route.
export const MIN_PRE_QUIET_MINUTES = 15
export const MAX_PRE_QUIET_MINUTES = 180
export const MIN_BURN_PREWARN_MINUTES = 15
/** MUST stay below BURN_PREWARN_REALERT_MS, or hysteresis swallows a second burn cycle's warning. */
export const MAX_BURN_PREWARN_MINUTES = 360

export const BURN_PREWARN_REALERT_MS = fullRealertMsFor(
  TOKEN_BURN_PERIOD_SECONDS
)

/** Under 24h so DST drift cannot skip a night; over the widest lead so one window pings once. */
export const PRE_QUIET_REALERT_MS = 20 * 60 * 60 * 1000

const DEFAULT_SCHEDULE_LEAD_MINUTES = 30

export interface AlertPrefsInput {
  alert_on_full: boolean
  alert_on_full_repeat_hours?: number | null
  alert_before_full: boolean
  alert_before_full_minutes: number
  alert_on_token_gained: boolean

  alert_on_bomb_ready?: boolean | null
  alert_before_bomb_ready?: boolean | null
  alert_before_bomb_ready_minutes?: number | null

  quiet_hours_start?: number | null
  quiet_hours_end?: number | null
  quiet_hours_timezone?: string | null

  alert_before_quiet_hours?: boolean | null
  alert_before_quiet_hours_minutes?: number | null
  alert_before_burn?: boolean | null
  alert_before_burn_minutes?: number | null
}

export interface AlertStateInput {
  last_tokens: number | null
  last_time_to_full_seconds: number | null
  last_full_alert_at: string | null
  last_prewarn_alert_at: string | null
  last_gain_alert_at: string | null

  last_bombs?: number | null
  last_time_to_bomb_seconds?: number | null
  last_bomb_ready_alert_at?: string | null
  last_bomb_prewarn_alert_at?: string | null

  quiet_hours_deferred_since?: string | null

  capped_since?: string | null
  last_pre_quiet_alert_at?: string | null
  last_burn_prewarn_alert_at?: string | null
  /** Previous scan's wall clock; ONLY back-dates a fresh capped_since. */
  last_scan_at?: string | null
}

export interface BombReadingInput {
  bombsAvailable: number
  bombNextInSeconds: number | null
  dataSource: string | null
  /** player_mapping.* fields are trust signals only, never recomputation inputs. */
  mappingNextBombSeconds: number | null
  mappingLastSyncBombs: number | null
  /** timestamp without time zone, read as UTC. */
  mappingLastSyncAt: string | null
}

export interface DecideAlertsInput {
  now: Date
  prefs: AlertPrefsInput
  state: AlertStateInput | null
  tokens: number
  tokenNextInSeconds: number | null
  bomb?: BombReadingInput | null
}

export interface ResourceObservation {
  amount: number
  timeToFullSeconds: number | null
}

export type FreezeReason =
  | 'pending_alert'
  | 'quiet_hours_defer'
  /** Persisting an untrusted reading would poison the crossing guard. */
  | 'untrusted_reading'

/** advance false: do NOT write the baseline, keeping the crossing guard armed. `observed: null`
 * makes persisting a frozen baseline a type error instead of a silent disarm. */
export type ResourceStateWrite =
  | { readonly advance: true; readonly observed: ResourceObservation }
  | {
      readonly advance: false
      readonly observed: null
      readonly freezeReason: FreezeReason
    }

export type QuietHoursAction = 'none' | 'defer' | 'drop'

export interface QuietHoursDecision {
  enabled: boolean
  active: boolean
  action: QuietHoursAction
  suppressed: AlertType | null
  deferredSince: string | null
  maxDeferOverride: boolean
  /** Set when unusable quiet hours made the core fail OPEN; scan.ts MUST log it at warn. */
  configError: string | null
}

export interface DecideAlertsResult {
  alerts: AlertType[]
  observed: ObservedTokenState
  bombTrusted: boolean
  stateWrites: {
    token: ResourceStateWrite
    bomb: ResourceStateWrite
  }
  quietHours: QuietHoursDecision
  /** Persist verbatim every tick (null clears); never frozen. */
  cappedSince: string | null
}

export interface ResourcePrefProjection {
  fullEnabled: boolean
  fullRepeatHours: number | null
  prewarnEnabled: boolean
  prewarnWindowSeconds: number
  gainedEnabled: boolean
}

export interface ResourceStateProjection {
  lastAmount: number | null
  lastTimeToFullSeconds: number | null
  lastFullAlertAt: string | null
  lastPrewarnAlertAt: string | null
  lastGainAlertAt: string | null
}

export interface ResourceHysteresis {
  full: number
  prewarn: number
  gained: number | null
}

export interface ResourceSpec {
  key: ResourceKey
  cap: number
  regenSeconds: number
  hysteresis: ResourceHysteresis
  maxPrewarnMinutes: number
  alertTypes: {
    full: AlertType
    prewarn: AlertType
    /** Null for bombs: at cap 1 "gained" and "ready" are the same event. */
    gained: AlertType | null
  }
  readPrefs: (prefs: AlertPrefsInput) => ResourcePrefProjection
  readState: (state: AlertStateInput | null) => ResourceStateProjection
}

export const TOKEN_SPEC: ResourceSpec = {
  key: 'token',
  cap: MAX_TOKENS,
  regenSeconds: TWELVE_HOURS_IN_SECONDS,
  hysteresis: {
    full: FULL_REALERT_MS,
    prewarn: PREWARN_REALERT_MS,
    gained: GAIN_REALERT_MS
  },
  maxPrewarnMinutes: MAX_TOKEN_PREWARN_MINUTES,
  alertTypes: { full: 'full', prewarn: 'prewarn', gained: 'gained' },
  readPrefs: (prefs) => ({
    fullEnabled: prefs.alert_on_full,
    fullRepeatHours: prefs.alert_on_full_repeat_hours ?? null,
    prewarnEnabled: prefs.alert_before_full,
    prewarnWindowSeconds: prefs.alert_before_full_minutes * 60,
    gainedEnabled: prefs.alert_on_token_gained
  }),
  readState: (state) => ({
    lastAmount: state?.last_tokens ?? null,
    lastTimeToFullSeconds: state?.last_time_to_full_seconds ?? null,
    lastFullAlertAt: state?.last_full_alert_at ?? null,
    lastPrewarnAlertAt: state?.last_prewarn_alert_at ?? null,
    lastGainAlertAt: state?.last_gain_alert_at ?? null
  })
}

export const BOMB_SPEC: ResourceSpec = {
  key: 'bomb',
  cap: MAX_BOMBS,
  regenSeconds: EIGHTEEN_HOURS_IN_SECONDS,
  hysteresis: {
    full: BOMB_READY_REALERT_MS,
    prewarn: BOMB_PREWARN_REALERT_MS,
    gained: null
  },
  maxPrewarnMinutes: MAX_BOMB_PREWARN_MINUTES,
  alertTypes: { full: 'bomb_ready', prewarn: 'bomb_prewarn', gained: null },
  readPrefs: (prefs) => ({
    fullEnabled: prefs.alert_on_bomb_ready === true,
    fullRepeatHours: null,
    prewarnEnabled: prefs.alert_before_bomb_ready === true,
    prewarnWindowSeconds:
      (prefs.alert_before_bomb_ready_minutes ?? DEFAULT_PREWARN_MINUTES) * 60,
    gainedEnabled: false
  }),
  readState: (state) => ({
    lastAmount: state?.last_bombs ?? null,
    lastTimeToFullSeconds: state?.last_time_to_bomb_seconds ?? null,
    lastFullAlertAt: state?.last_bomb_ready_alert_at ?? null,
    lastPrewarnAlertAt: state?.last_bomb_prewarn_alert_at ?? null,
    lastGainAlertAt: null
  })
}

function elapsedAtLeast(now: Date, since: string | null, ms: number): boolean {
  if (since == null) return true
  const sinceMs = Date.parse(since)
  if (!Number.isFinite(sinceMs)) return true
  return now.getTime() - sinceMs >= ms
}

/** `Date.parse` on the bare form is engine-dependent and would shift by the host's UTC offset. */
export function parseTimestampWithoutTimeZoneAsUtc(
  value: string | null
): number | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const hasZone = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(trimmed)
  const normalized = hasZone
    ? trimmed.replace(' ', 'T')
    : `${trimmed.replace(' ', 'T')}Z`
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export const BOMB_SYNC_FRESHNESS_MS = 24 * 60 * 60 * 1000

/** Deliberately stricter than the RPC's predicate: a missed nudge is recoverable, a wrong
 * "bomb ready" DM is not. Do not "optimize" it into an exact derivation. */
export function isBombReadingTrusted(
  reading: BombReadingInput,
  now: Date
): boolean {
  if (reading.dataSource !== 'live') return false
  if (reading.mappingNextBombSeconds == null) return false
  // Not redundant: this NULL alone drops the RPC to its coalesce fallback.
  if (reading.mappingLastSyncBombs == null) return false
  const syncedAtMs = parseTimestampWithoutTimeZoneAsUtc(
    reading.mappingLastSyncAt
  )
  if (syncedAtMs == null) return false
  const age = now.getTime() - syncedAtMs
  return age >= 0 && age <= BOMB_SYNC_FRESHNESS_MS
}

/** Backstop on one unbroken deferral run; unreachable while windows are whole hours. Do not lower it. */
export const QUIET_HOURS_MAX_DEFER_MS = 24 * 60 * 60 * 1000

/** Persistent conditions defer; a transient gain drops (replay would burst stale DMs). */
const DEFERRING_ALERTS: ReadonlySet<AlertType> = new Set<AlertType>([
  'full',
  'prewarn',
  'bomb_ready',
  'bomb_prewarn'
])

/** Whole hours only, matching the DB CHECKs; no tolerant 'HH:MM' parser. */
function isValidHour(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23
  )
}

export function localTimeInZone(
  now: Date,
  timeZone: string
): { hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now)
    const rawHour = parts.find((part) => part.type === 'hour')?.value
    const rawMinute = parts.find((part) => part.type === 'minute')?.value
    if (rawHour == null || rawMinute == null) return null
    const hour = Number(rawHour)
    const minute = Number(rawMinute)
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    // Some engines render midnight as hour 24 under hour12:false.
    return { hour: hour % 24, minute }
  } catch {
    return null
  }
}

export function localHourInZone(now: Date, timeZone: string): number | null {
  return localTimeInZone(now, timeZone)?.hour ?? null
}

/** In (0, 1440]: on the boundary the window just opened. Only measures a lead; never widens the window. */
export function minutesUntilLocalHour(
  now: Date,
  timeZone: string,
  targetHour: number
): number | null {
  const local = localTimeInZone(now, timeZone)
  if (local == null) return null
  if (!isValidHour(targetHour)) return null
  const raw = ((targetHour - local.hour + 24) % 24) * 60 - local.minute
  return raw > 0 ? raw : raw + 24 * 60
}

interface QuietHoursWindow {
  enabled: boolean
  active: boolean
  configError: string | null
  startHour: number | null
  endHour: number | null
  timeZone: string | null
}

/** Every disabling rule FAILS OPEN (the DM is delivered): a mistimed DM is visible and
 * self-correcting, silent suppression is not. No UTC default for a missing timezone. */
export function resolveQuietHours(
  prefs: AlertPrefsInput,
  now: Date
): QuietHoursWindow {
  const start = prefs.quiet_hours_start ?? null
  const end = prefs.quiet_hours_end ?? null
  const timeZone = prefs.quiet_hours_timezone ?? null

  const off: QuietHoursWindow = {
    enabled: false,
    active: false,
    configError: null,
    startHour: null,
    endHour: null,
    timeZone: null
  }

  if (start == null && end == null && timeZone == null) return off

  if (!isValidHour(start) || !isValidHour(end)) {
    return {
      ...off,
      configError:
        'quiet hours need both start and end as a whole hour 0..23 ' +
        `(got start=${String(start)}, end=${String(end)}); failing open`
    }
  }

  // DISABLED, not "quiet forever" (which would defer alerts indefinitely).
  if (start === end) return off

  if (timeZone == null || timeZone.trim() === '') {
    return {
      ...off,
      configError:
        'quiet hours configured without a timezone; failing open ' +
        '(a UTC default would DM an Eastern-time user at 3am)'
    }
  }

  const hour = localHourInZone(now, timeZone)
  if (hour == null) {
    return {
      ...off,
      configError: `quiet hours timezone is not a usable IANA zone (got ${timeZone}); failing open`
    }
  }

  const active =
    start < end
      ? hour >= start && hour < end
      : // Wraps midnight.
        hour >= start || hour < end
  return {
    enabled: true,
    active,
    configError: null,
    startHour: start,
    endHour: end,
    timeZone
  }
}

export function quietWindowSeconds(startHour: number, endHour: number): number {
  return ((endHour - startHour + 24) % 24 || 24) * 60 * 60
}

/** No burn countdown exists; the anchor comes only from observing the below-cap -> at-cap crossing.
 * An existing anchor is returned verbatim (re-deriving from a frozen baseline drifts); with no
 * observed crossing it stays null, since anchoring on now() predicts a wrong time. */
export function deriveCappedSince(
  now: Date,
  tokens: number,
  cap: number,
  state: AlertStateInput | null
): string | null {
  if (tokens < cap) return null

  const prior = state?.capped_since ?? null
  if (prior != null && Number.isFinite(Date.parse(prior))) return prior

  const lastAmount = state?.last_tokens ?? null
  if (lastAmount == null || lastAmount >= cap) return null

  const lastScanMs = state?.last_scan_at ? Date.parse(state.last_scan_at) : NaN
  const remaining = state?.last_time_to_full_seconds ?? null
  if (Number.isFinite(lastScanMs) && remaining != null && remaining > 0) {
    const estimate = lastScanMs + remaining * 1000
    if (estimate > lastScanMs && estimate <= now.getTime()) {
      return new Date(estimate).toISOString()
    }
  }
  return now.toISOString()
}

/** Burns land at `cappedSince + period*k` for k >= 1. */
export function secondsToNextBurn(
  now: Date,
  cappedSince: string | null
): number | null {
  if (cappedSince == null) return null
  const anchorMs = Date.parse(cappedSince)
  if (!Number.isFinite(anchorMs)) return null
  const elapsedSeconds = (now.getTime() - anchorMs) / 1000
  if (elapsedSeconds < 0) return null
  return (
    TOKEN_BURN_PERIOD_SECONDS - (elapsedSeconds % TOKEN_BURN_PERIOD_SECONDS)
  )
}

function clampLeadMinutes(
  value: number | null | undefined,
  min: number,
  max: number
): number {
  const raw = value ?? DEFAULT_SCHEDULE_LEAD_MINUTES
  if (!Number.isFinite(raw)) return min
  return Math.min(Math.max(raw, min), max)
}

/** Only while the window is inactive; kept out of DEFERRING_ALERTS so a regression drops it, not delays it. */
function evaluatePreQuiet(
  prefs: AlertPrefsInput,
  state: AlertStateInput | null,
  quiet: QuietHoursWindow,
  observed: ResourceObservation,
  now: Date
): boolean {
  if (prefs.alert_before_quiet_hours !== true) return false
  if (!quiet.enabled || quiet.active) return false
  if (
    quiet.startHour == null ||
    quiet.endHour == null ||
    quiet.timeZone == null
  )
    return false

  const leadMinutes = clampLeadMinutes(
    prefs.alert_before_quiet_hours_minutes,
    MIN_PRE_QUIET_MINUTES,
    MAX_PRE_QUIET_MINUTES
  )
  const untilStartMinutes = minutesUntilLocalHour(
    now,
    quiet.timeZone,
    quiet.startHour
  )
  if (untilStartMinutes == null || untilStartMinutes > leadMinutes) return false

  // The horizon runs to the END of the window: the point is tokens burned during it.
  const atCap = observed.amount >= TOKEN_SPEC.cap
  const horizonSeconds =
    untilStartMinutes * 60 + quietWindowSeconds(quiet.startHour, quiet.endHour)
  const willCapDuringWindow =
    !atCap &&
    observed.timeToFullSeconds != null &&
    observed.timeToFullSeconds > 0 &&
    observed.timeToFullSeconds <= horizonSeconds
  if (!atCap && !willCapDuringWindow) return false

  return elapsedAtLeast(
    now,
    state?.last_pre_quiet_alert_at ?? null,
    PRE_QUIET_REALERT_MS
  )
}

/** No crossing guard: hysteresis and lead bounds already admit one warning per burn cycle. */
function evaluateBurnPrewarn(
  prefs: AlertPrefsInput,
  state: AlertStateInput | null,
  cappedSince: string | null,
  observed: ResourceObservation,
  now: Date
): boolean {
  if (prefs.alert_before_burn !== true) return false
  if (observed.amount < TOKEN_SPEC.cap) return false

  const secondsToBurn = secondsToNextBurn(now, cappedSince)
  if (secondsToBurn == null) return false

  const leadSeconds =
    clampLeadMinutes(
      prefs.alert_before_burn_minutes,
      MIN_BURN_PREWARN_MINUTES,
      MAX_BURN_PREWARN_MINUTES
    ) * 60
  if (secondsToBurn > leadSeconds) return false

  return elapsedAtLeast(
    now,
    state?.last_burn_prewarn_alert_at ?? null,
    BURN_PREWARN_REALERT_MS
  )
}

export function computeTimeToCapSeconds(
  amount: number,
  nextInSeconds: number | null,
  cap: number,
  regenSeconds: number
): number | null {
  if (amount >= cap) return 0
  if (nextInSeconds == null) return null
  return nextInSeconds + (cap - amount - 1) * regenSeconds
}

export function computeTimeToFullSeconds(
  tokens: number,
  tokenNextInSeconds: number | null
): number | null {
  return computeTimeToCapSeconds(
    tokens,
    tokenNextInSeconds,
    MAX_TOKENS,
    TWELVE_HOURS_IN_SECONDS
  )
}

interface ResourceEvaluation {
  observed: ResourceObservation
  candidates: AlertType[]
}

function evaluateResource(
  spec: ResourceSpec,
  prefs: AlertPrefsInput,
  state: AlertStateInput | null,
  reading: { amount: number; nextInSeconds: number | null },
  now: Date
): ResourceEvaluation {
  const invalid =
    reading.amount < 0 ||
    (reading.nextInSeconds != null && reading.nextInSeconds < 0)

  const safeAmount = Math.min(Math.max(reading.amount, 0), spec.cap)
  const safeNext =
    reading.nextInSeconds == null ? null : Math.max(reading.nextInSeconds, 0)
  const timeToFullSeconds = computeTimeToCapSeconds(
    safeAmount,
    safeNext,
    spec.cap,
    spec.regenSeconds
  )
  const observed: ResourceObservation = {
    amount: safeAmount,
    timeToFullSeconds
  }

  if (invalid) return { observed, candidates: [] }

  const p = spec.readPrefs(prefs)
  const s = spec.readState(state)

  const fullTransition =
    p.fullEnabled &&
    safeAmount >= spec.cap &&
    (s.lastAmount == null || s.lastAmount < spec.cap) &&
    elapsedAtLeast(now, s.lastFullAlertAt, spec.hysteresis.full)

  // A repeat reuses lastFullAlertAt, so failed sends do not advance the stamp.
  // The clamp minimum may never undercut the anti-flap window.
  const fullRepeatHours =
    p.fullRepeatHours == null
      ? null
      : Math.min(
          Math.max(p.fullRepeatHours, MIN_FULL_REPEAT_HOURS),
          MAX_FULL_REPEAT_HOURS
        )
  const fullRepeat =
    p.fullEnabled &&
    spec.key === 'token' &&
    fullRepeatHours != null &&
    safeAmount >= spec.cap &&
    (s.lastFullAlertAt == null ||
      elapsedAtLeast(
        now,
        s.lastFullAlertAt,
        Math.max(fullRepeatHours * HOUR_MS, spec.hysteresis.full)
      ))
  const full = fullTransition || fullRepeat

  // Clamped (not rejected) in case a pref bypassed the DB CHECK.
  const windowSeconds = Math.min(
    Math.max(p.prewarnWindowSeconds, 0),
    spec.maxPrewarnMinutes * 60
  )
  const prewarn =
    p.prewarnEnabled &&
    safeAmount < spec.cap &&
    timeToFullSeconds != null &&
    timeToFullSeconds > 0 &&
    timeToFullSeconds <= windowSeconds &&
    // Crossing guard: previous reading outside the window. A previous 0 means at cap; without that
    // escape the guard is unsatisfiable at the token ceiling and the user is never pre-warned again.
    (s.lastTimeToFullSeconds == null ||
      s.lastTimeToFullSeconds === 0 ||
      s.lastTimeToFullSeconds > windowSeconds) &&
    elapsedAtLeast(now, s.lastPrewarnAlertAt, spec.hysteresis.prewarn)

  const gained =
    p.gainedEnabled &&
    spec.alertTypes.gained != null &&
    spec.hysteresis.gained != null &&
    s.lastAmount != null &&
    safeAmount > s.lastAmount &&
    elapsedAtLeast(now, s.lastGainAlertAt, spec.hysteresis.gained)

  const candidates: AlertType[] = []
  if (full) candidates.push(spec.alertTypes.full)
  if (prewarn) candidates.push(spec.alertTypes.prewarn)
  if (gained && spec.alertTypes.gained != null) {
    candidates.push(spec.alertTypes.gained)
  }
  return { observed, candidates }
}

export function decideAlerts(input: DecideAlertsInput): DecideAlertsResult {
  const { now, prefs, state } = input

  const tokenEval = evaluateResource(
    TOKEN_SPEC,
    prefs,
    state,
    { amount: input.tokens, nextInSeconds: input.tokenNextInSeconds },
    now
  )

  const bombReading = input.bomb ?? null
  const bombTrusted =
    bombReading != null && isBombReadingTrusted(bombReading, now)
  const bombEval: ResourceEvaluation | null =
    bombReading != null && bombTrusted
      ? evaluateResource(
          BOMB_SPEC,
          prefs,
          state,
          {
            amount: bombReading.bombsAvailable,
            nextInSeconds: bombReading.bombNextInSeconds
          },
          now
        )
      : null

  // Resolved before precedence (pre_quiet depends on it); suppression applies after the winner is picked.
  const quiet = resolveQuietHours(prefs, now)
  const { enabled, active, configError } = quiet

  const cappedSince = deriveCappedSince(
    now,
    tokenEval.observed.amount,
    TOKEN_SPEC.cap,
    state
  )

  const qualified = new Set<AlertType>([
    ...tokenEval.candidates,
    ...(bombEval?.candidates ?? [])
  ])
  if (evaluatePreQuiet(prefs, state, quiet, tokenEval.observed, now)) {
    qualified.add('pre_quiet')
  }
  if (evaluateBurnPrewarn(prefs, state, cappedSince, tokenEval.observed, now)) {
    qualified.add('burn_prewarn')
  }

  const winner = ALERT_PRECEDENCE.find((type) => qualified.has(type)) ?? null

  let action: QuietHoursAction = 'none'
  let maxDeferOverride = false

  if (winner != null && enabled && active) {
    action = DEFERRING_ALERTS.has(winner) ? 'defer' : 'drop'
    if (action === 'defer') {
      const deferredSince = state?.quiet_hours_deferred_since ?? null
      if (
        deferredSince != null &&
        elapsedAtLeast(now, deferredSince, QUIET_HOURS_MAX_DEFER_MS)
      ) {
        action = 'none'
        maxDeferOverride = true
      }
    }
  }

  const delivered = action === 'none' ? winner : null
  const dropped = action === 'drop' ? winner : null

  // Clear the valve anchor ONLY when the run ends (delivery or outside the window); clearing inside
  // the window would re-anchor it forever and let quiet hours suppress indefinitely.
  const priorAnchor = state?.quiet_hours_deferred_since ?? null
  let deferredSince: string | null
  if (action === 'defer') {
    deferredSince = priorAnchor ?? now.toISOString()
  } else if (active && delivered == null) {
    deferredSince = priorAnchor
  } else {
    deferredSince = null
  }

  const quietHours: QuietHoursDecision = {
    enabled,
    active,
    action,
    suppressed: action === 'none' ? null : winner,
    deferredSince,
    maxDeferOverride,
    configError
  }

  // Freeze a resource whose alert qualified but was not delivered so it fires
  // later. A DROPPED alert advances so it is not re-detected as stale catch-up.
  const writeFor = (
    key: ResourceKey,
    evaluation: ResourceEvaluation | null
  ): ResourceStateWrite => {
    if (evaluation == null) {
      return {
        advance: false,
        observed: null,
        freezeReason: 'untrusted_reading'
      }
    }
    const resourceQualified = evaluation.candidates.length > 0
    const resourceDelivered =
      delivered != null && ALERT_RESOURCE[delivered] === key
    const resourceDropped = dropped != null && ALERT_RESOURCE[dropped] === key
    if (!resourceQualified || resourceDelivered || resourceDropped) {
      return { advance: true, observed: evaluation.observed }
    }
    return {
      advance: false,
      observed: null,
      freezeReason:
        action === 'defer' &&
        quietHours.suppressed != null &&
        ALERT_RESOURCE[quietHours.suppressed] === key
          ? 'quiet_hours_defer'
          : 'pending_alert'
    }
  }

  return {
    alerts: delivered == null ? [] : [delivered],
    observed: {
      tokens: tokenEval.observed.amount,
      timeToFullSeconds: tokenEval.observed.timeToFullSeconds
    },
    bombTrusted,
    stateWrites: {
      token: writeFor('token', tokenEval),
      bomb: writeFor('bomb', bombEval)
    },
    quietHours,
    cappedSince
  }
}

/** Pre-quiet and pre-burn warnings stay silent when the burn anchor is unknown. */

import { describe, expect, it } from 'vitest'
import {
  ALERT_PRECEDENCE,
  BURN_PREWARN_REALERT_MS,
  MAX_BURN_PREWARN_MINUTES,
  MAX_PRE_QUIET_MINUTES,
  PRE_QUIET_REALERT_MS,
  TOKEN_BURN_PERIOD_SECONDS,
  decideAlerts,
  deriveCappedSince,
  localTimeInZone,
  minutesUntilLocalHour,
  quietWindowSeconds,
  secondsToNextBurn
} from '@/app/lib/token-alerts/decision-core'
import type {
  AlertPrefsInput,
  AlertStateInput
} from '@/app/lib/token-alerts/decision-core'
import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

const ZONE = 'America/New_York'
/** 22 -> 07 local, a window that wraps midnight (the shipped UI default). */
const QUIET_START = 22
const QUIET_END = 7

const NOW = new Date('2026-07-18T12:00:00.000Z')
/** 01:40Z (next day) == 21:40 EDT: 20 minutes before the window opens. */
const NEAR_QUIET = new Date('2026-07-19T01:40:00.000Z')
const FAR_FROM_QUIET = new Date('2026-07-19T00:40:00.000Z')
/** 07:00Z (next day) == 03:00 EDT: inside the window. */
const INSIDE_QUIET = new Date('2026-07-19T07:00:00.000Z')

const BASE_PREFS: AlertPrefsInput = {
  alert_on_full: false,
  alert_on_full_repeat_hours: null,
  alert_before_full: false,
  alert_before_full_minutes: 120,
  alert_on_token_gained: false,
  alert_on_bomb_ready: false,
  alert_before_bomb_ready: false,
  alert_before_bomb_ready_minutes: 120,
  alert_before_quiet_hours: false,
  alert_before_quiet_hours_minutes: 30,
  alert_before_burn: false,
  alert_before_burn_minutes: 30
}

const prefs = (overrides: Partial<AlertPrefsInput> = {}): AlertPrefsInput => ({
  ...BASE_PREFS,
  ...overrides
})

const quietPrefs = (overrides: Partial<AlertPrefsInput> = {}) =>
  prefs({
    quiet_hours_start: QUIET_START,
    quiet_hours_end: QUIET_END,
    quiet_hours_timezone: ZONE,
    ...overrides
  })

const state = (overrides: Partial<AlertStateInput> = {}): AlertStateInput => ({
  last_tokens: null,
  last_time_to_full_seconds: null,
  last_full_alert_at: null,
  last_prewarn_alert_at: null,
  last_gain_alert_at: null,
  last_bombs: null,
  last_time_to_bomb_seconds: null,
  last_bomb_ready_alert_at: null,
  last_bomb_prewarn_alert_at: null,
  quiet_hours_deferred_since: null,
  capped_since: null,
  last_pre_quiet_alert_at: null,
  last_burn_prewarn_alert_at: null,
  last_scan_at: null,
  ...overrides
})

const cappedFor = (
  now: Date,
  msAgo: number,
  extra: Partial<AlertStateInput> = {}
) =>
  state({
    last_tokens: MAX_TOKENS,
    capped_since: new Date(now.getTime() - msAgo).toISOString(),
    last_scan_at: new Date(now.getTime() - 5 * MINUTE_MS).toISOString(),
    ...extra
  })

const AT_CAP = { tokens: MAX_TOKENS, tokenNextInSeconds: null }

describe('deriveCappedSince', () => {
  it('clears the anchor whenever the player drops below cap', () => {
    // Spending resets the regen anchor, mirroring compute_player_token_burn.
    expect(
      deriveCappedSince(
        NOW,
        MAX_TOKENS - 1,
        MAX_TOKENS,
        cappedFor(NOW, 3 * HOUR_MS)
      )
    ).toBeNull()
  })

  it('is STICKY — an existing anchor is returned verbatim', () => {
    // The token baseline freezes when an alert loses precedence, so re-deriving per tick walks the anchor.
    const anchor = new Date(NOW.getTime() - 7 * HOUR_MS).toISOString()
    const prior = cappedFor(NOW, 7 * HOUR_MS, {
      last_time_to_full_seconds: 30_000
    })
    expect(prior.capped_since).toBe(anchor)
    expect(deriveCappedSince(NOW, MAX_TOKENS, MAX_TOKENS, prior)).toBe(anchor)
  })

  it('back-dates a fresh crossing to the true instant, not the tick that saw it', () => {
    const crossed = deriveCappedSince(
      NOW,
      MAX_TOKENS,
      MAX_TOKENS,
      state({
        last_tokens: MAX_TOKENS - 1,
        last_scan_at: new Date(NOW.getTime() - 5 * MINUTE_MS).toISOString(),
        last_time_to_full_seconds: 120
      })
    )
    expect(crossed).toBe(new Date(NOW.getTime() - 3 * MINUTE_MS).toISOString())
  })

  it('clamps a back-date that would land in the future down to now', () => {
    // A stale reading can only make the estimate late; the clamp degrades it to now().
    const crossed = deriveCappedSince(
      NOW,
      MAX_TOKENS,
      MAX_TOKENS,
      state({
        last_tokens: MAX_TOKENS - 1,
        last_scan_at: new Date(NOW.getTime() - MINUTE_MS).toISOString(),
        last_time_to_full_seconds: 9_999
      })
    )
    expect(crossed).toBe(NOW.toISOString())
  })

  it('stays NULL on a first-ever scan that is already at cap', () => {
    // Deliberate cold-start gap: a missed nudge is recoverable, a wrong one is not.
    expect(deriveCappedSince(NOW, MAX_TOKENS, MAX_TOKENS, null)).toBeNull()
    expect(deriveCappedSince(NOW, MAX_TOKENS, MAX_TOKENS, state())).toBeNull()
  })

  it('stays NULL when the previous observation was ALREADY at cap', () => {
    expect(
      deriveCappedSince(
        NOW,
        MAX_TOKENS,
        MAX_TOKENS,
        state({ last_tokens: MAX_TOKENS, last_scan_at: NOW.toISOString() })
      )
    ).toBeNull()
  })

  it('re-derives rather than trusting an unparseable stored anchor', () => {
    expect(
      deriveCappedSince(
        NOW,
        MAX_TOKENS,
        MAX_TOKENS,
        state({ capped_since: 'not-a-timestamp', last_tokens: MAX_TOKENS })
      )
    ).toBeNull()
  })
})

describe('secondsToNextBurn', () => {
  it('puts the FIRST burn one full regen cycle after the crossing', () => {
    // The cycle in progress at cap produced the held token, so nothing is lost until the next.
    const anchor = new Date(NOW.getTime()).toISOString()
    expect(secondsToNextBurn(NOW, anchor)).toBe(TOKEN_BURN_PERIOD_SECONDS)
  })

  it('counts down within a cycle and wraps to the next one', () => {
    const anchor = new Date(NOW.getTime() - 11 * HOUR_MS).toISOString()
    expect(secondsToNextBurn(NOW, anchor)).toBe(HOUR_MS / 1000)

    const older = new Date(NOW.getTime() - 13 * HOUR_MS).toISOString()
    expect(secondsToNextBurn(NOW, older)).toBe(11 * (HOUR_MS / 1000))
  })

  it('is null without an anchor, and null for a future anchor', () => {
    expect(secondsToNextBurn(NOW, null)).toBeNull()
    expect(secondsToNextBurn(NOW, 'nonsense')).toBeNull()
    expect(
      secondsToNextBurn(NOW, new Date(NOW.getTime() + HOUR_MS).toISOString())
    ).toBeNull()
  })
})

describe('burn_prewarn', () => {
  const burnPrefs = (overrides: Partial<AlertPrefsInput> = {}) =>
    prefs({
      alert_before_burn: true,
      alert_before_burn_minutes: 30,
      ...overrides
    })

  const decide = (now: Date, s: AlertStateInput, p = burnPrefs()) =>
    decideAlerts({ now, prefs: p, state: s, ...AT_CAP })

  it('fires once the next burn is inside the lead window', () => {
    const result = decide(NOW, cappedFor(NOW, 11 * HOUR_MS + 40 * MINUTE_MS))
    expect(result.alerts).toEqual(['burn_prewarn'])
  })

  it('stays silent while the burn is still beyond the lead', () => {
    expect(decide(NOW, cappedFor(NOW, 11 * HOUR_MS)).alerts).toEqual([])
  })

  it('stays silent with NO anchor even though the player is capped', () => {
    const result = decide(
      NOW,
      state({ last_tokens: MAX_TOKENS, last_scan_at: NOW.toISOString() })
    )
    expect(result.alerts).toEqual([])
    expect(result.cappedSince).toBeNull()
  })

  it('never fires below cap', () => {
    const result = decideAlerts({
      now: NOW,
      prefs: burnPrefs(),
      state: cappedFor(NOW, 11 * HOUR_MS + 40 * MINUTE_MS),
      tokens: MAX_TOKENS - 1,
      tokenNextInSeconds: 600
    })
    expect(result.alerts).toEqual([])
    expect(result.cappedSince).toBeNull()
  })

  it('does not re-fire inside the same burn cycle', () => {
    const s = cappedFor(NOW, 11 * HOUR_MS + 40 * MINUTE_MS, {
      last_burn_prewarn_alert_at: new Date(
        NOW.getTime() - HOUR_MS
      ).toISOString()
    })
    expect(decide(NOW, s).alerts).toEqual([])
  })

  it('fires again on the NEXT burn cycle', () => {
    const s = cappedFor(NOW, 23 * HOUR_MS + 40 * MINUTE_MS, {
      last_burn_prewarn_alert_at: new Date(
        NOW.getTime() - 12 * HOUR_MS
      ).toISOString()
    })
    expect(decide(NOW, s).alerts).toEqual(['burn_prewarn'])
  })

  it('clamps a lead that bypassed the DB CHECK', () => {
    const s = cappedFor(NOW, 4 * HOUR_MS)
    expect(
      decide(NOW, s, burnPrefs({ alert_before_burn_minutes: 10_000 })).alerts
    ).toEqual([])
  })

  it('DROPS rather than defers inside quiet hours', () => {
    // A deferred burn warning would describe a destroyed token; pre_quiet covers overnight.
    const result = decideAlerts({
      now: INSIDE_QUIET,
      prefs: quietPrefs({
        alert_before_burn: true,
        alert_before_burn_minutes: 30
      }),
      state: cappedFor(INSIDE_QUIET, 11 * HOUR_MS + 40 * MINUTE_MS),
      ...AT_CAP
    })
    expect(result.alerts).toEqual([])
    expect(result.quietHours.action).toBe('drop')
    expect(result.quietHours.suppressed).toBe('burn_prewarn')
  })

  it('keeps the lead ceiling below the re-alert hysteresis', () => {
    // A lead wider than the hysteresis could fire twice in one span and swallow a cycle.
    expect(MAX_BURN_PREWARN_MINUTES * MINUTE_MS).toBeLessThan(
      BURN_PREWARN_REALERT_MS
    )
    expect(TOKEN_BURN_PERIOD_SECONDS).toBe(TWELVE_HOURS_IN_SECONDS)
  })
})

describe('pre_quiet', () => {
  const preQuietPrefs = (overrides: Partial<AlertPrefsInput> = {}) =>
    quietPrefs({
      alert_before_quiet_hours: true,
      alert_before_quiet_hours_minutes: 30,
      ...overrides
    })

  it('fires when capped and the window is about to open', () => {
    const result = decideAlerts({
      now: NEAR_QUIET,
      prefs: preQuietPrefs(),
      state: cappedFor(NEAR_QUIET, 2 * HOUR_MS),
      ...AT_CAP
    })
    expect(result.alerts).toEqual(['pre_quiet'])
  })

  it('fires when NOT yet capped but capping during the window', () => {
    const result = decideAlerts({
      now: NEAR_QUIET,
      prefs: preQuietPrefs(),
      state: state({ last_tokens: 1, last_time_to_full_seconds: 20_000 }),
      tokens: MAX_TOKENS - 1,
      tokenNextInSeconds: 4 * 60 * 60
    })
    expect(result.alerts).toEqual(['pre_quiet'])
  })

  it('stays silent when the cap lands AFTER the window closes', () => {
    const result = decideAlerts({
      now: NEAR_QUIET,
      prefs: preQuietPrefs(),
      state: state({ last_tokens: 1, last_time_to_full_seconds: 60_000 }),
      tokens: MAX_TOKENS - 1,
      tokenNextInSeconds: 11 * 60 * 60
    })
    expect(result.alerts).toEqual([])
  })

  it('stays silent while the window is still far off', () => {
    expect(
      decideAlerts({
        now: FAR_FROM_QUIET,
        prefs: preQuietPrefs(),
        state: cappedFor(FAR_FROM_QUIET, 2 * HOUR_MS),
        ...AT_CAP
      }).alerts
    ).toEqual([])
  })

  it('stays silent while the window is already ACTIVE', () => {
    // The lead precedes the window by construction, so this alert cannot suppress itself.
    expect(
      decideAlerts({
        now: INSIDE_QUIET,
        prefs: preQuietPrefs(),
        state: cappedFor(INSIDE_QUIET, 2 * HOUR_MS),
        ...AT_CAP
      }).alerts
    ).toEqual([])
  })

  it('stays silent when quiet hours are not configured', () => {
    // No instant to measure a lead against; a DB CHECK forbids it and the core never fires.
    expect(
      decideAlerts({
        now: NEAR_QUIET,
        prefs: prefs({ alert_before_quiet_hours: true }),
        state: cappedFor(NEAR_QUIET, 2 * HOUR_MS),
        ...AT_CAP
      }).alerts
    ).toEqual([])
  })

  it('pings at most once per night', () => {
    const s = cappedFor(NEAR_QUIET, 2 * HOUR_MS, {
      last_pre_quiet_alert_at: new Date(
        NEAR_QUIET.getTime() - 3 * HOUR_MS
      ).toISOString()
    })
    expect(
      decideAlerts({
        now: NEAR_QUIET,
        prefs: preQuietPrefs(),
        state: s,
        ...AT_CAP
      }).alerts
    ).toEqual([])
    expect(PRE_QUIET_REALERT_MS).toBeGreaterThan(
      MAX_PRE_QUIET_MINUTES * MINUTE_MS
    )
  })

  it('outranks a same-tick `full` WITHOUT consuming its baseline', () => {
    // Both qualify; pre_quiet wins, so the token baseline stays frozen to keep `full` armed.
    const result = decideAlerts({
      now: NEAR_QUIET,
      prefs: preQuietPrefs({ alert_on_full: true }),
      state: state({
        last_tokens: MAX_TOKENS - 1,
        last_time_to_full_seconds: 120,
        last_scan_at: new Date(
          NEAR_QUIET.getTime() - 5 * MINUTE_MS
        ).toISOString()
      }),
      ...AT_CAP
    })

    expect(result.alerts).toEqual(['pre_quiet'])
    expect(result.stateWrites.token.advance).toBe(false)
    expect(result.stateWrites.token).toMatchObject({
      freezeReason: 'pending_alert'
    })
    expect(result.cappedSince).not.toBeNull()
  })

  it('ranks first in the ladder, ahead of burn_prewarn and full', () => {
    expect(ALERT_PRECEDENCE.indexOf('pre_quiet')).toBe(0)
    expect(ALERT_PRECEDENCE.indexOf('burn_prewarn')).toBeLessThan(
      ALERT_PRECEDENCE.indexOf('full')
    )
  })
})

describe('minutesUntilLocalHour', () => {
  it('measures to the next occurrence of the hour, minutes included', () => {
    expect(minutesUntilLocalHour(NEAR_QUIET, ZONE, QUIET_START)).toBe(20)
    expect(minutesUntilLocalHour(FAR_FROM_QUIET, ZONE, QUIET_START)).toBe(80)
  })

  it('wraps a whole day rather than returning zero or a negative', () => {
    expect(minutesUntilLocalHour(INSIDE_QUIET, ZONE, QUIET_START)).toBe(19 * 60)
  })

  it('is null for an unusable zone or a non-hour target', () => {
    expect(minutesUntilLocalHour(NOW, 'Mars/Olympus_Mons', 22)).toBeNull()
    expect(minutesUntilLocalHour(NOW, ZONE, 24)).toBeNull()
    expect(minutesUntilLocalHour(NOW, ZONE, -1)).toBeNull()
  })

  it('resolves DST through the platform tz database, not a fixed offset', () => {
    // Same UTC instant, different local hour under EST vs EDT: why a stored offset is wrong.
    expect(localTimeInZone(NOW, ZONE)).toEqual({ hour: 8, minute: 0 })
    expect(localTimeInZone(new Date('2026-01-18T12:00:00.000Z'), ZONE)).toEqual(
      { hour: 7, minute: 0 }
    )
  })
})

describe('quietWindowSeconds', () => {
  it('measures a wrapping window across midnight', () => {
    expect(quietWindowSeconds(QUIET_START, QUIET_END)).toBe(9 * 60 * 60)
    expect(quietWindowSeconds(1, 6)).toBe(5 * 60 * 60)
  })
})

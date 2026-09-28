import { describe, expect, it } from 'vitest'
import {
  FULL_REALERT_MS,
  GAIN_REALERT_MS,
  PREWARN_REALERT_MS,
  computeTimeToFullSeconds,
  decideAlerts
} from '@/app/lib/token-alerts/decision-core'
import type {
  UserTokenAlertPrefs,
  UserTokenAlertState
} from '@/app/lib/token-alerts/types'
import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

const NOW = new Date('2026-07-18T12:00:00.000Z')

const msAgo = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const minutesAgo = (m: number) => msAgo(m * 60_000)

const ALL_ON: UserTokenAlertPrefs = {
  user_id: 'user-1',
  alert_on_full: true,
  alert_on_full_repeat_hours: null,
  alert_before_full: true,
  alert_before_full_minutes: 120,
  alert_on_token_gained: true
}

const ALL_OFF: UserTokenAlertPrefs = {
  ...ALL_ON,
  alert_on_full: false,
  alert_before_full: false,
  alert_on_token_gained: false
}

const prefs = (
  overrides: Partial<UserTokenAlertPrefs> = {}
): UserTokenAlertPrefs => ({ ...ALL_ON, ...overrides })

const state = (
  overrides: Partial<UserTokenAlertState> = {}
): UserTokenAlertState => ({
  user_id: 'user-1',
  last_tokens: null,
  last_time_to_full_seconds: null,
  last_scan_at: null,
  last_full_alert_at: null,
  last_prewarn_alert_at: null,
  last_gain_alert_at: null,
  consecutive_dm_failures: 0,
  dm_blocked_at: null,
  dm_channel_id: null,
  dm_channel_recipient_id: null,
  ...overrides
})

const decide = (args: {
  prefs?: UserTokenAlertPrefs
  state?: UserTokenAlertState | null
  tokens: number
  tokenNextInSeconds?: number | null
}) =>
  decideAlerts({
    now: NOW,
    prefs: args.prefs ?? ALL_ON,
    state: args.state === undefined ? null : args.state,
    tokens: args.tokens,
    tokenNextInSeconds:
      args.tokenNextInSeconds === undefined ? null : args.tokenNextInSeconds
  })

describe('computeTimeToFullSeconds', () => {
  it('returns 0 at cap', () => {
    expect(computeTimeToFullSeconds(MAX_TOKENS, 600)).toBe(0)
  })

  it('returns 0 above cap (defensive over-cap reading)', () => {
    expect(computeTimeToFullSeconds(MAX_TOKENS + 1, 600)).toBe(0)
  })

  it('returns null below cap when the projection has no next-token estimate', () => {
    expect(computeTimeToFullSeconds(2, null)).toBeNull()
    expect(computeTimeToFullSeconds(0, null)).toBeNull()
  })

  it('one token short costs only the in-flight regen', () => {
    expect(computeTimeToFullSeconds(2, 600)).toBe(600)
  })

  it('two tokens short adds one full 12h cycle', () => {
    expect(computeTimeToFullSeconds(1, 600)).toBe(600 + TWELVE_HOURS_IN_SECONDS)
    expect(computeTimeToFullSeconds(1, 600)).toBe(43800)
  })

  it('three tokens short adds two full 12h cycles', () => {
    expect(computeTimeToFullSeconds(0, 600)).toBe(
      600 + 2 * TWELVE_HOURS_IN_SECONDS
    )
    expect(computeTimeToFullSeconds(0, 600)).toBe(87000)
  })
})

describe('decideAlerts — hysteresis constants', () => {
  it('exposes the documented re-alert windows', () => {
    expect(FULL_REALERT_MS).toBe(11 * 60 * 60 * 1000)
    expect(PREWARN_REALERT_MS).toBe(6 * 60 * 60 * 1000)
    expect(GAIN_REALERT_MS).toBe(55 * 60 * 1000)
  })
})

describe("decideAlerts — 'full'", () => {
  it('fires on a first-ever scan already at cap', () => {
    expect(decide({ state: null, tokens: 3 }).alerts).toEqual(['full'])
  })

  it('fires on the below-cap -> at-cap transition', () => {
    expect(
      decide({ state: state({ last_tokens: 2 }), tokens: 3 }).alerts
    ).toEqual(['full'])
  })

  it('does NOT fire when the user was already sitting at cap', () => {
    expect(
      decide({ state: state({ last_tokens: 3 }), tokens: 3 }).alerts
    ).toEqual([])
  })

  it('fires when state exists but has no token baseline yet', () => {
    expect(
      decide({ state: state({ last_tokens: null }), tokens: 3 }).alerts
    ).toEqual(['full'])
  })

  // A cap crossing is also a gain, so gained is disabled to isolate 'full'.
  it('does NOT fire when the last full alert was 10h59m ago (still armed down)', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_token_gained: false }),
        state: state({
          last_tokens: 2,
          last_full_alert_at: msAgo(FULL_REALERT_MS - 60_000)
        }),
        tokens: 3
      }).alerts
    ).toEqual([])
  })

  it('fires when the last full alert was 11h01m ago', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_token_gained: false }),
        state: state({
          last_tokens: 2,
          last_full_alert_at: msAgo(FULL_REALERT_MS + 60_000)
        }),
        tokens: 3
      }).alerts
    ).toEqual(['full'])
  })

  it('does not fire when alert_on_full is off', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full: false, alert_on_token_gained: false }),
        state: state({ last_tokens: 2 }),
        tokens: 3
      }).alerts
    ).toEqual([])
  })

  it("falls through to 'gained' when 'full' is suppressed but the cap-crossing was a real gain", () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full: false }),
        state: state({ last_tokens: 2 }),
        tokens: 3
      }).alerts
    ).toEqual(['gained'])

    expect(
      decide({
        state: state({
          last_tokens: 2,
          last_full_alert_at: msAgo(FULL_REALERT_MS - 60_000)
        }),
        tokens: 3
      }).alerts
    ).toEqual(['gained'])
  })
})

describe("decideAlerts — repeating 'full' reminders", () => {
  it('repeats while still full once the configured cadence elapses', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full_repeat_hours: 12 }),
        state: state({
          last_tokens: 3,
          last_full_alert_at: msAgo(12 * 60 * 60 * 1000)
        }),
        tokens: 3
      }).alerts
    ).toEqual(['full'])
  })

  it('does not repeat before the configured cadence elapses', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full_repeat_hours: 12 }),
        state: state({
          last_tokens: 3,
          last_full_alert_at: msAgo(12 * 60 * 60 * 1000 - 60_000)
        }),
        tokens: 3
      }).alerts
    ).toEqual([])
  })

  it('does not repeat after the player spends below cap', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full_repeat_hours: 12 }),
        state: state({
          last_tokens: 3,
          last_full_alert_at: msAgo(24 * 60 * 60 * 1000)
        }),
        tokens: 2,
        tokenNextInSeconds: 40_000
      }).alerts
    ).toEqual([])
  })

  it('immediately establishes a schedule when repeats are enabled while already full', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full_repeat_hours: 12 }),
        state: state({ last_tokens: 3, last_full_alert_at: null }),
        tokens: 3
      }).alerts
    ).toEqual(['full'])
  })

  it('keeps the existing transition-only behavior when repeats are disabled', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full_repeat_hours: null }),
        state: state({
          last_tokens: 3,
          last_full_alert_at: msAgo(7 * 24 * 60 * 60 * 1000)
        }),
        tokens: 3
      }).alerts
    ).toEqual([])
  })

  it('never repeats when the parent full alert is off', () => {
    expect(
      decide({
        prefs: prefs({
          alert_on_full: false,
          alert_on_full_repeat_hours: 12,
          alert_on_token_gained: false
        }),
        state: state({
          last_tokens: 3,
          last_full_alert_at: msAgo(24 * 60 * 60 * 1000)
        }),
        tokens: 3
      }).alerts
    ).toEqual([])
  })
})

describe("decideAlerts — 'prewarn'", () => {
  const WINDOW_SECONDS = 120 * 60 // alert_before_full_minutes: 120

  it('fires when crossing INTO the window from outside it', () => {
    expect(
      decide({
        state: state({ last_tokens: 2, last_time_to_full_seconds: 8000 }),
        tokens: 2,
        tokenNextInSeconds: 6800
      }).alerts
    ).toEqual(['prewarn'])
  })

  it('does NOT re-fire while sitting inside the window', () => {
    expect(
      decide({
        state: state({ last_tokens: 2, last_time_to_full_seconds: 7000 }),
        tokens: 2,
        tokenNextInSeconds: 6800
      }).alerts
    ).toEqual([])
  })

  it('fires on a first observation inside the window (no prior time-to-full baseline)', () => {
    expect(
      decide({
        state: state({ last_tokens: 2, last_time_to_full_seconds: null }),
        tokens: 2,
        tokenNextInSeconds: 6800
      }).alerts
    ).toEqual(['prewarn'])
  })

  it('does not fire when still outside the window', () => {
    expect(
      decide({
        state: state({ last_tokens: 2, last_time_to_full_seconds: 20000 }),
        tokens: 2,
        tokenNextInSeconds: WINDOW_SECONDS + 1
      }).alerts
    ).toEqual([])
  })

  it('fires exactly at the window boundary (inclusive)', () => {
    expect(
      decide({
        state: state({ last_tokens: 2, last_time_to_full_seconds: 20000 }),
        tokens: 2,
        tokenNextInSeconds: WINDOW_SECONDS
      }).alerts
    ).toEqual(['prewarn'])
  })

  it('does NOT fire when time-to-full is exactly 0 (that is the full case)', () => {
    const result = decide({
      prefs: prefs({ alert_on_full: false }),
      state: state({ last_tokens: 3, last_time_to_full_seconds: 20000 }),
      tokens: 3,
      tokenNextInSeconds: 0
    })
    expect(result.observed.timeToFullSeconds).toBe(0)
    expect(result.alerts).toEqual([])
  })

  it('does NOT fire when time-to-full is null (no projection estimate)', () => {
    const result = decide({
      state: state({ last_tokens: 2, last_time_to_full_seconds: 20000 }),
      tokens: 2,
      tokenNextInSeconds: null
    })
    expect(result.observed.timeToFullSeconds).toBeNull()
    expect(result.alerts).toEqual([])
  })

  it('does NOT fire when the last prewarn alert was under 6h ago', () => {
    expect(
      decide({
        state: state({
          last_tokens: 2,
          last_time_to_full_seconds: 8000,
          last_prewarn_alert_at: msAgo(PREWARN_REALERT_MS - 60_000)
        }),
        tokens: 2,
        tokenNextInSeconds: 6800
      }).alerts
    ).toEqual([])
  })

  it('fires again once the 6h prewarn hysteresis has elapsed', () => {
    expect(
      decide({
        state: state({
          last_tokens: 2,
          last_time_to_full_seconds: 8000,
          last_prewarn_alert_at: msAgo(PREWARN_REALERT_MS + 60_000)
        }),
        tokens: 2,
        tokenNextInSeconds: 6800
      }).alerts
    ).toEqual(['prewarn'])
  })

  it('does not fire when alert_before_full is off', () => {
    expect(
      decide({
        prefs: prefs({ alert_before_full: false }),
        state: state({ last_tokens: 2, last_time_to_full_seconds: 8000 }),
        tokens: 2,
        tokenNextInSeconds: 6800
      }).alerts
    ).toEqual([])
  })

  it('honours a custom pre-cap window', () => {
    const inside = decide({
      prefs: prefs({
        alert_before_full_minutes: 30,
        alert_on_token_gained: false
      }),
      state: state({ last_tokens: 2, last_time_to_full_seconds: 5000 }),
      tokens: 2,
      tokenNextInSeconds: 1800
    })
    const outside = decide({
      prefs: prefs({
        alert_before_full_minutes: 30,
        alert_on_token_gained: false
      }),
      state: state({ last_tokens: 2, last_time_to_full_seconds: 5000 }),
      tokens: 2,
      tokenNextInSeconds: 2400
    })
    expect(inside.alerts).toEqual(['prewarn'])
    expect(outside.alerts).toEqual([])
  })

  // A previous 0 means "was at cap"; counting it as inside breaks the 720-minute guard.
  it('fires at the 720-minute setting on the first below-cap tick after being at cap', () => {
    expect(
      decide({
        prefs: prefs({
          alert_before_full_minutes: 720,
          alert_on_full: false,
          alert_on_token_gained: false
        }),
        state: state({ last_tokens: 3, last_time_to_full_seconds: 0 }),
        tokens: 2,
        tokenNextInSeconds: 43200
      }).alerts
    ).toEqual(['prewarn'])
  })

  it('still suppresses the very next tick once inside the window (no re-fire)', () => {
    expect(
      decide({
        prefs: prefs({
          alert_before_full_minutes: 720,
          alert_on_full: false,
          alert_on_token_gained: false
        }),
        state: state({ last_tokens: 2, last_time_to_full_seconds: 43200 }),
        tokens: 2,
        tokenNextInSeconds: 42900
      }).alerts
    ).toEqual([])
  })

  it('fires after an at-cap observation for a narrow window too', () => {
    expect(
      decide({
        prefs: prefs({
          alert_before_full_minutes: 120,
          alert_on_full: false,
          alert_on_token_gained: false
        }),
        state: state({ last_tokens: 3, last_time_to_full_seconds: 0 }),
        tokens: 2,
        tokenNextInSeconds: 3600
      }).alerts
    ).toEqual(['prewarn'])
  })
})

describe("decideAlerts — 'gained'", () => {
  it('never fires on a first-ever scan — it only baselines', () => {
    const result = decide({ state: null, tokens: 2, tokenNextInSeconds: 40000 })
    expect(result.alerts).toEqual([])
    expect(result.observed.tokens).toBe(2)
  })

  it('never fires when state exists but has no token baseline', () => {
    expect(
      decide({
        state: state({ last_tokens: null }),
        tokens: 2,
        tokenNextInSeconds: 40000
      }).alerts
    ).toEqual([])
  })

  it('fires on a +1 gain', () => {
    expect(
      decide({
        state: state({ last_tokens: 0 }),
        tokens: 1,
        tokenNextInSeconds: 40000
      }).alerts
    ).toEqual(['gained'])
  })

  it('fires once on a +2 jump', () => {
    expect(
      decide({
        state: state({ last_tokens: 0 }),
        tokens: 2,
        tokenNextInSeconds: 40000
      }).alerts
    ).toEqual(['gained'])
  })

  it('does not fire when tokens are unchanged or dropped (a spend)', () => {
    expect(
      decide({
        state: state({ last_tokens: 2 }),
        tokens: 2,
        tokenNextInSeconds: 40000
      }).alerts
    ).toEqual([])
    expect(
      decide({
        state: state({ last_tokens: 2 }),
        tokens: 1,
        tokenNextInSeconds: 40000
      }).alerts
    ).toEqual([])
  })

  it('does NOT fire when the last gain alert was under 55 minutes ago', () => {
    expect(
      decide({
        state: state({
          last_tokens: 0,
          last_gain_alert_at: minutesAgo(54)
        }),
        tokens: 1,
        tokenNextInSeconds: 40000
      }).alerts
    ).toEqual([])
  })

  it('fires again once the 55-minute gain hysteresis has elapsed', () => {
    expect(
      decide({
        state: state({
          last_tokens: 0,
          last_gain_alert_at: msAgo(GAIN_REALERT_MS + 60_000)
        }),
        tokens: 1,
        tokenNextInSeconds: 40000
      }).alerts
    ).toEqual(['gained'])
  })

  it('does not fire when alert_on_token_gained is off', () => {
    expect(
      decide({
        prefs: prefs({ alert_on_token_gained: false }),
        state: state({ last_tokens: 0 }),
        tokens: 1,
        tokenNextInSeconds: 40000
      }).alerts
    ).toEqual([])
  })
})

describe('decideAlerts — precedence (at most one alert per tick)', () => {
  it("'full' suppresses a simultaneously-qualifying 'gained'", () => {
    const result = decide({
      state: state({ last_tokens: 1 }),
      tokens: 3,
      tokenNextInSeconds: 0
    })
    expect(result.alerts).toEqual(['full'])
    expect(result.alerts).toHaveLength(1)
  })

  it("'prewarn' suppresses a simultaneously-qualifying 'gained'", () => {
    const result = decide({
      state: state({ last_tokens: 1, last_time_to_full_seconds: 8000 }),
      tokens: 2,
      tokenNextInSeconds: 6800
    })
    expect(result.alerts).toEqual(['prewarn'])
    expect(result.alerts).toHaveLength(1)
  })

  it("'full' wins over a simultaneously-qualifying 'prewarn' and 'gained'", () => {
    const result = decide({
      state: state({ last_tokens: 0, last_time_to_full_seconds: 90000 }),
      tokens: 3,
      tokenNextInSeconds: 0
    })
    expect(result.alerts).toEqual(['full'])
  })
})

describe('decideAlerts — invalid inputs and clamping', () => {
  it('suppresses alerts on negative tokens but still returns clamped observed', () => {
    const result = decide({
      state: state({ last_tokens: 0 }),
      tokens: -1,
      tokenNextInSeconds: 600
    })
    expect(result.alerts).toEqual([])
    expect(result.observed.tokens).toBe(0)
    expect(result.observed.timeToFullSeconds).toBe(87000)
  })

  it('suppresses alerts on a negative next-token estimate but clamps it to 0', () => {
    const result = decide({
      state: state({ last_tokens: 2, last_time_to_full_seconds: 8000 }),
      tokens: 2,
      tokenNextInSeconds: -600
    })
    expect(result.alerts).toEqual([])
    expect(result.observed.tokens).toBe(2)
    expect(result.observed.timeToFullSeconds).toBe(0)
  })

  it('clamps an over-cap reading down to MAX_TOKENS', () => {
    const result = decide({ state: state({ last_tokens: 2 }), tokens: 99 })
    expect(result.observed.tokens).toBe(MAX_TOKENS)
    expect(result.observed.timeToFullSeconds).toBe(0)
    expect(result.alerts).toEqual(['full'])
  })

  it('observed.tokens is always within 0..MAX_TOKENS', () => {
    for (const tokens of [-5, -1, 0, 1, 2, 3, 4, 100]) {
      const observed = decide({ state: null, tokens }).observed
      expect(observed.tokens).toBeGreaterThanOrEqual(0)
      expect(observed.tokens).toBeLessThanOrEqual(MAX_TOKENS)
    }
  })
})

describe('decideAlerts — all toggles off', () => {
  it('never alerts regardless of the transition', () => {
    const scenarios: Array<Parameters<typeof decide>[0]> = [
      { prefs: ALL_OFF, state: null, tokens: 3 },
      { prefs: ALL_OFF, state: state({ last_tokens: 2 }), tokens: 3 },
      {
        prefs: ALL_OFF,
        state: state({ last_tokens: 2, last_time_to_full_seconds: 8000 }),
        tokens: 2,
        tokenNextInSeconds: 6800
      },
      {
        prefs: ALL_OFF,
        state: state({ last_tokens: 0 }),
        tokens: 2,
        tokenNextInSeconds: 40000
      }
    ]
    for (const scenario of scenarios) {
      expect(decide(scenario).alerts).toEqual([])
    }
  })
})

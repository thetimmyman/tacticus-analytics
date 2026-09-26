import { describe, expect, it } from 'vitest'
import {
  ALERT_PRECEDENCE,
  ALERT_RESOURCE,
  BOMB_PREWARN_REALERT_MS,
  BOMB_READY_REALERT_MS,
  BOMB_SPEC,
  BOMB_SYNC_FRESHNESS_MS,
  FULL_REALERT_MS,
  MAX_BOMB_PREWARN_MINUTES,
  MAX_TOKEN_PREWARN_MINUTES,
  PREWARN_REALERT_MS,
  QUIET_HOURS_MAX_DEFER_MS,
  TOKEN_SPEC,
  decideAlerts,
  fullRealertMsFor,
  isBombReadingTrusted,
  localHourInZone,
  parseTimestampWithoutTimeZoneAsUtc,
  prewarnRealertMsFor,
  resolveQuietHours
} from '@/app/lib/token-alerts/decision-core'
import type {
  AlertPrefsInput,
  AlertStateInput,
  BombReadingInput,
  DecideAlertsInput,
  FreezeReason,
  ResourceObservation,
  ResourceStateWrite
} from '@/app/lib/token-alerts/decision-core'
import { MAX_BOMBS } from '@/app/lib/calculations/bomb-availability'
import {
  EIGHTEEN_HOURS_IN_SECONDS,
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

const HOUR_MS = 60 * 60 * 1000

const NOW = new Date('2026-07-18T12:00:00.000Z')
const QUIET_NOW = new Date('2026-07-18T07:00:00.000Z')

const ZONE = 'America/New_York'
const QUIET_START = 22
const QUIET_END = 7

const msAgoFrom = (now: Date, ms: number) =>
  new Date(now.getTime() - ms).toISOString()

const ALL_ON: AlertPrefsInput = {
  alert_on_full: true,
  alert_on_full_repeat_hours: null,
  alert_before_full: true,
  alert_before_full_minutes: 120,
  alert_on_token_gained: true,
  alert_on_bomb_ready: true,
  alert_before_bomb_ready: true,
  alert_before_bomb_ready_minutes: 120
}

const prefs = (overrides: Partial<AlertPrefsInput> = {}): AlertPrefsInput => ({
  ...ALL_ON,
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
  ...overrides
})

const trustedBomb = (
  now: Date,
  overrides: Partial<BombReadingInput> = {}
): BombReadingInput => ({
  bombsAvailable: 0,
  bombNextInSeconds: EIGHTEEN_HOURS_IN_SECONDS,
  dataSource: 'live',
  mappingNextBombSeconds: 1000,
  mappingLastSyncBombs: 0,
  mappingLastSyncAt: new Date(now.getTime() - HOUR_MS)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', ''),
  ...overrides
})

const QUIET_TOKENS = { tokens: 1, tokenNextInSeconds: 40_000 }
const quietTokenState = {
  last_tokens: 1,
  last_time_to_full_seconds: 40_000 + TWELVE_HOURS_IN_SECONDS
}

it('defers a due repeating full reminder through the existing full lane', () => {
  const result = decide({
    now: QUIET_NOW,
    prefs: quietPrefs({ alert_on_full_repeat_hours: 12 }),
    state: state({
      last_tokens: MAX_TOKENS,
      last_full_alert_at: msAgoFrom(QUIET_NOW, 12 * HOUR_MS)
    }),
    tokens: MAX_TOKENS,
    tokenNextInSeconds: null
  })

  expect(result.alerts).toEqual([])
  expect(result.quietHours.action).toBe('defer')
  expect(result.quietHours.suppressed).toBe('full')
  expectFrozen(result.stateWrites.token, 'quiet_hours_defer')
})

const decide = (args: Partial<DecideAlertsInput> & { now?: Date }) =>
  decideAlerts({
    now: args.now ?? NOW,
    prefs: args.prefs ?? ALL_ON,
    state: args.state === undefined ? null : args.state,
    tokens: args.tokens ?? QUIET_TOKENS.tokens,
    tokenNextInSeconds:
      args.tokenNextInSeconds === undefined
        ? QUIET_TOKENS.tokenNextInSeconds
        : args.tokenNextInSeconds,
    bomb: args.bomb
  })

/** Frozen writes carry `observed: null`, so tests cannot assert on a frozen baseline. */
function expectAdvanced(write: ResourceStateWrite): ResourceObservation {
  expect(write.advance).toBe(true)
  if (!write.advance) throw new Error('expected an advancing state write')
  return write.observed
}

function expectFrozen(write: ResourceStateWrite, reason: FreezeReason): void {
  expect(write.advance).toBe(false)
  if (write.advance) throw new Error('expected a frozen state write')
  expect(write.observed).toBeNull()
  expect(write.freezeReason).toBe(reason)
}

describe('ResourceSpec — hysteresis derivation', () => {
  it('derives the full/ready re-alert window as one hour short of a regen cycle', () => {
    expect(fullRealertMsFor(TWELVE_HOURS_IN_SECONDS)).toBe(11 * HOUR_MS)
    expect(fullRealertMsFor(EIGHTEEN_HOURS_IN_SECONDS)).toBe(17 * HOUR_MS)
  })

  it('derives the pre-warn re-alert window as half a regen cycle', () => {
    expect(prewarnRealertMsFor(TWELVE_HOURS_IN_SECONDS)).toBe(6 * HOUR_MS)
    expect(prewarnRealertMsFor(EIGHTEEN_HOURS_IN_SECONDS)).toBe(9 * HOUR_MS)
  })

  it('reproduces the WI-3990 token constants exactly', () => {
    expect(FULL_REALERT_MS).toBe(11 * HOUR_MS)
    expect(PREWARN_REALERT_MS).toBe(6 * HOUR_MS)
  })

  it('gives bombs the 18h-derived analogues, not the token values', () => {
    expect(BOMB_READY_REALERT_MS).toBe(17 * HOUR_MS)
    expect(BOMB_PREWARN_REALERT_MS).toBe(9 * HOUR_MS)
    expect(BOMB_READY_REALERT_MS).not.toBe(FULL_REALERT_MS)
    expect(BOMB_PREWARN_REALERT_MS).not.toBe(PREWARN_REALERT_MS)
  })

  it('keeps every re-alert window strictly inside its own regen cycle', () => {
    // Longer than the regen cycle would swallow the next legitimate crossing.
    for (const spec of [TOKEN_SPEC, BOMB_SPEC]) {
      expect(spec.hysteresis.full).toBeLessThan(spec.regenSeconds * 1000)
      expect(spec.hysteresis.prewarn).toBeLessThan(spec.regenSeconds * 1000)
    }
  })

  it('carries cap, regen, hysteresis AND the pref projection per resource', () => {
    expect(TOKEN_SPEC.cap).toBe(MAX_TOKENS)
    expect(TOKEN_SPEC.regenSeconds).toBe(TWELVE_HOURS_IN_SECONDS)
    expect(BOMB_SPEC.cap).toBe(MAX_BOMBS)
    expect(BOMB_SPEC.cap).toBe(1)
    expect(BOMB_SPEC.regenSeconds).toBe(EIGHTEEN_HOURS_IN_SECONDS)

    expect(
      TOKEN_SPEC.readPrefs(
        prefs({ alert_before_full_minutes: 30, alert_on_token_gained: false })
      )
    ).toEqual({
      fullEnabled: true,
      fullRepeatHours: null,
      prewarnEnabled: true,
      prewarnWindowSeconds: 1800,
      gainedEnabled: false
    })
    expect(
      BOMB_SPEC.readPrefs(prefs({ alert_before_bomb_ready_minutes: 45 }))
    ).toEqual({
      fullEnabled: true,
      fullRepeatHours: null,
      prewarnEnabled: true,
      prewarnWindowSeconds: 2700,
      gainedEnabled: false
    })
  })

  it('gives bombs NO gained lane, because at cap 1 ready and gained coincide', () => {
    expect(BOMB_SPEC.alertTypes.gained).toBeNull()
    expect(BOMB_SPEC.hysteresis.gained).toBeNull()
    expect(BOMB_SPEC.readPrefs(ALL_ON).gainedEnabled).toBe(false)
    expect(ALERT_PRECEDENCE).not.toContain('bomb_gained')
  })

  it('sets the token ceiling to its regen period and the bomb ceiling SHORT of its own', () => {
    // 720 == the 12h regen period: satisfiable only via the at-cap-0 escape.
    expect(MAX_TOKEN_PREWARN_MINUTES).toBe(720)
    expect(MAX_TOKEN_PREWARN_MINUTES * 60).toBe(TOKEN_SPEC.regenSeconds)

    // Deliberately below the 1080-minute regen period, where it would always be true.
    expect(MAX_BOMB_PREWARN_MINUTES).toBe(960)
    expect(MAX_BOMB_PREWARN_MINUTES * 60).toBeLessThan(BOMB_SPEC.regenSeconds)
    expect(BOMB_SPEC.regenSeconds - MAX_BOMB_PREWARN_MINUTES * 60).toBe(
      2 * 60 * 60
    )
  })
})

describe('parseTimestampWithoutTimeZoneAsUtc', () => {
  it('interprets a zoneless Postgres timestamp as UTC, not host-local', () => {
    // `timestamp without time zone` carries no offset; bare Date.parse is host-dependent.
    expect(parseTimestampWithoutTimeZoneAsUtc('2026-07-18 11:00:00')).toBe(
      Date.UTC(2026, 6, 18, 11, 0, 0)
    )
    expect(parseTimestampWithoutTimeZoneAsUtc('2026-07-18T11:00:00')).toBe(
      Date.UTC(2026, 6, 18, 11, 0, 0)
    )
    expect(parseTimestampWithoutTimeZoneAsUtc('2026-07-18 11:00:00.123')).toBe(
      Date.UTC(2026, 6, 18, 11, 0, 0, 123)
    )
  })

  it('respects an explicit offset when one is present', () => {
    expect(parseTimestampWithoutTimeZoneAsUtc('2026-07-18T11:00:00Z')).toBe(
      Date.UTC(2026, 6, 18, 11, 0, 0)
    )
    expect(
      parseTimestampWithoutTimeZoneAsUtc('2026-07-18T11:00:00+02:00')
    ).toBe(Date.UTC(2026, 6, 18, 9, 0, 0))
  })

  it('returns null for missing or unparseable values', () => {
    expect(parseTimestampWithoutTimeZoneAsUtc(null)).toBeNull()
    expect(parseTimestampWithoutTimeZoneAsUtc('')).toBeNull()
    expect(parseTimestampWithoutTimeZoneAsUtc('   ')).toBeNull()
    expect(parseTimestampWithoutTimeZoneAsUtc('not-a-timestamp')).toBeNull()
  })
})

describe('isBombReadingTrusted — CONSERVATIVE SUPERSET of the RPC snapshot branch', () => {
  it('trusts a live reading with both mapping trust columns and a fresh sync', () => {
    expect(isBombReadingTrusted(trustedBomb(NOW), NOW)).toBe(true)
  })

  it('rejects anything other than data_source = live', () => {
    for (const dataSource of ['snapshot', 'projection', 'stale', null]) {
      expect(isBombReadingTrusted(trustedBomb(NOW, { dataSource }), NOW)).toBe(
        false
      )
    }
  })

  it('rejects a null mapping next_bomb_seconds (the bomb_pure branch fell back)', () => {
    expect(
      isBombReadingTrusted(
        trustedBomb(NOW, { mappingNextBombSeconds: null }),
        NOW
      )
    ).toBe(false)
  })

  // A NULL last_sync_bombs makes the RPC coalesce to 1; trusting it sends a false "bomb ready" DM.
  it('rejects a null last_sync_bombs even when next_bomb_seconds is set', () => {
    expect(
      isBombReadingTrusted(
        trustedBomb(NOW, {
          mappingLastSyncBombs: null,
          mappingNextBombSeconds: 1000,
          dataSource: 'live'
        }),
        NOW
      )
    ).toBe(false)
  })

  // Deliberately conservative: a missed nudge is recoverable, a wrong DM is not.
  it('also rejects the degenerate bomb_spent case — deliberately conservative', () => {
    expect(
      isBombReadingTrusted(
        trustedBomb(NOW, {
          mappingLastSyncBombs: 1,
          mappingNextBombSeconds: null
        }),
        NOW
      )
    ).toBe(false)
  })

  it('rejects a null or unparseable last_sync_at', () => {
    expect(
      isBombReadingTrusted(trustedBomb(NOW, { mappingLastSyncAt: null }), NOW)
    ).toBe(false)
    expect(
      isBombReadingTrusted(
        trustedBomb(NOW, { mappingLastSyncAt: 'garbage' }),
        NOW
      )
    ).toBe(false)
  })

  it('rejects a sync older than 24h and accepts one just inside it', () => {
    const stale = new Date(NOW.getTime() - BOMB_SYNC_FRESHNESS_MS - 60_000)
    const fresh = new Date(NOW.getTime() - BOMB_SYNC_FRESHNESS_MS + 60_000)
    const asPg = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '')
    expect(
      isBombReadingTrusted(
        trustedBomb(NOW, { mappingLastSyncAt: asPg(stale) }),
        NOW
      )
    ).toBe(false)
    expect(
      isBombReadingTrusted(
        trustedBomb(NOW, { mappingLastSyncAt: asPg(fresh) }),
        NOW
      )
    ).toBe(true)
  })

  it('rejects a sync timestamped in the future (clock skew)', () => {
    const future = new Date(NOW.getTime() + 2 * HOUR_MS)
    expect(
      isBombReadingTrusted(
        trustedBomb(NOW, {
          mappingLastSyncAt: future
            .toISOString()
            .replace('T', ' ')
            .replace('Z', '')
        }),
        NOW
      )
    ).toBe(false)
  })
})

describe('decideAlerts — untrusted bomb readings', () => {
  it('emits no bomb alert and FREEZES the bomb baseline when untrusted', () => {
    const result = decide({
      state: state(quietTokenState),
      bomb: trustedBomb(NOW, { bombsAvailable: 1, dataSource: 'snapshot' })
    })
    expect(result.alerts).toEqual([])
    expect(result.bombTrusted).toBe(false)
    expectFrozen(result.stateWrites.bomb, 'untrusted_reading')
  })

  it('still evaluates and advances TOKENS when the bomb reading is untrusted', () => {
    const result = decide({
      state: state({ last_tokens: 2 }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0,
      bomb: trustedBomb(NOW, { bombsAvailable: 1, dataSource: 'snapshot' })
    })
    expect(result.alerts).toEqual(['full'])
    expectAdvanced(result.stateWrites.token)
  })

  it('treats an omitted bomb reading as untrusted and frozen', () => {
    const result = decide({ state: state(quietTokenState) })
    expect(result.bombTrusted).toBe(false)
    expectFrozen(result.stateWrites.bomb, 'untrusted_reading')
    expect(result.alerts).toEqual([])
  })

  /** The freeze keeps the last trusted observation so the crossing guard stays armed. */
  it('does NOT lose a bomb_ready across an untrusted stretch (0 -> 1 walk)', () => {
    const below = { ...quietTokenState, last_bombs: 0 }

    const trusted0 = decide({
      state: state(below),
      bomb: trustedBomb(NOW, { bombsAvailable: 0 })
    })
    expect(trusted0.alerts).toEqual([])
    expect(expectAdvanced(trusted0.stateWrites.bomb).amount).toBe(0)

    for (const untrustworthy of [
      { dataSource: 'snapshot' },
      { mappingNextBombSeconds: null },
      { mappingLastSyncBombs: null },
      { mappingLastSyncAt: null }
    ]) {
      const tick = decide({
        state: state(below),
        bomb: trustedBomb(NOW, {
          bombsAvailable: MAX_BOMBS,
          bombNextInSeconds: 0,
          ...untrustworthy
        })
      })
      expect(tick.bombTrusted).toBe(false)
      expect(tick.alerts).toEqual([])
      expectFrozen(tick.stateWrites.bomb, 'untrusted_reading')
    }

    const regained = decide({
      state: state(below),
      bomb: trustedBomb(NOW, {
        bombsAvailable: MAX_BOMBS,
        bombNextInSeconds: 0
      })
    })
    expect(regained.bombTrusted).toBe(true)
    expect(regained.alerts).toEqual(['bomb_ready'])
    expect(expectAdvanced(regained.stateWrites.bomb).amount).toBe(MAX_BOMBS)
  })

  it('does NOT lose a bomb_ready when the untrusted stretch starts at first-ever scan', () => {
    const first = decide({
      state: state({ ...quietTokenState, last_bombs: null }),
      bomb: trustedBomb(NOW, { bombsAvailable: MAX_BOMBS, dataSource: 'stale' })
    })
    expectFrozen(first.stateWrites.bomb, 'untrusted_reading')

    const regained = decide({
      state: state({ ...quietTokenState, last_bombs: null }),
      bomb: trustedBomb(NOW, {
        bombsAvailable: MAX_BOMBS,
        bombNextInSeconds: 0
      })
    })
    expect(regained.alerts).toEqual(['bomb_ready'])
  })
})

describe('pre-warn window is CLAMPED by spec.maxPrewarnMinutes', () => {
  // The DB CHECK bounds these too; unclamped, the pre-warning means "always".
  it('tokens: a window past the 720-minute ceiling does not widen the alert', () => {
    const timeToFull = MAX_TOKEN_PREWARN_MINUTES * 60 + 3600 // outside the ceiling
    const result = decide({
      prefs: prefs({
        alert_on_full: false,
        alert_on_token_gained: false,
        alert_before_full: true,
        alert_before_full_minutes: 5000
      }),
      state: state({ last_tokens: 2, last_time_to_full_seconds: null }),
      tokens: MAX_TOKENS - 1,
      tokenNextInSeconds: timeToFull
    })
    expect(timeToFull).toBeLessThan(5000 * 60)
    expect(result.alerts).toEqual([])
  })

  it('tokens: the ceiling itself still fires', () => {
    const result = decide({
      prefs: prefs({
        alert_on_full: false,
        alert_on_token_gained: false,
        alert_before_full: true,
        alert_before_full_minutes: 5000
      }),
      state: state({ last_tokens: 2, last_time_to_full_seconds: null }),
      tokens: MAX_TOKENS - 1,
      tokenNextInSeconds: MAX_TOKEN_PREWARN_MINUTES * 60
    })
    expect(result.alerts).toEqual(['prewarn'])
  })

  it('bombs: a window past the 960-minute ceiling does not widen the alert', () => {
    const timeToReady = MAX_BOMB_PREWARN_MINUTES * 60 + 3600
    const result = decide({
      prefs: prefs({
        alert_on_full: false,
        alert_before_full: false,
        alert_on_token_gained: false,
        alert_on_bomb_ready: false,
        alert_before_bomb_ready: true,
        alert_before_bomb_ready_minutes: 1080
      }),
      state: state({ ...quietTokenState, last_time_to_bomb_seconds: null }),
      bomb: trustedBomb(NOW, {
        bombsAvailable: 0,
        bombNextInSeconds: timeToReady
      })
    })
    expect(timeToReady).toBeLessThan(1080 * 60)
    expect(result.alerts).toEqual([])
  })

  it('bombs: the ceiling itself still fires', () => {
    const result = decide({
      prefs: prefs({
        alert_on_full: false,
        alert_before_full: false,
        alert_on_token_gained: false,
        alert_on_bomb_ready: false,
        alert_before_bomb_ready: true,
        alert_before_bomb_ready_minutes: 1080
      }),
      state: state({ ...quietTokenState, last_time_to_bomb_seconds: null }),
      bomb: trustedBomb(NOW, {
        bombsAvailable: 0,
        bombNextInSeconds: MAX_BOMB_PREWARN_MINUTES * 60
      })
    })
    expect(result.alerts).toEqual(['bomb_prewarn'])
  })
})

describe("decideAlerts — 'bomb_ready'", () => {
  const readyBomb = (overrides: Partial<BombReadingInput> = {}) =>
    trustedBomb(NOW, { bombsAvailable: 1, bombNextInSeconds: 0, ...overrides })

  it('fires on the 0 -> 1 transition', () => {
    expect(
      decide({
        state: state({ ...quietTokenState, last_bombs: 0 }),
        bomb: readyBomb()
      }).alerts
    ).toEqual(['bomb_ready'])
  })

  it('fires on a first-ever scan already holding a bomb', () => {
    expect(
      decide({
        state: state({ ...quietTokenState, last_bombs: null }),
        bomb: readyBomb()
      }).alerts
    ).toEqual(['bomb_ready'])
  })

  it('does NOT fire when the user was already sitting on a bomb', () => {
    expect(
      decide({
        state: state({ ...quietTokenState, last_bombs: 1 }),
        bomb: readyBomb()
      }).alerts
    ).toEqual([])
  })

  it('respects the 17h hysteresis, not the 11h token one', () => {
    const at = (ms: number) =>
      decide({
        state: state({
          ...quietTokenState,
          last_bombs: 0,
          last_bomb_ready_alert_at: msAgoFrom(NOW, ms)
        }),
        bomb: readyBomb()
      }).alerts

    expect(at(BOMB_READY_REALERT_MS - 60_000)).toEqual([])
    expect(at(BOMB_READY_REALERT_MS + 60_000)).toEqual(['bomb_ready'])
    expect(at(FULL_REALERT_MS + 60_000)).toEqual([])
  })

  it('does not fire when alert_on_bomb_ready is off or absent', () => {
    for (const value of [false, null, undefined]) {
      expect(
        decide({
          prefs: prefs({ alert_on_bomb_ready: value }),
          state: state({ ...quietTokenState, last_bombs: 0 }),
          bomb: readyBomb()
        }).alerts
      ).toEqual([])
    }
  })
})

describe("decideAlerts — 'bomb_prewarn'", () => {
  it('fires when crossing INTO the window from outside it', () => {
    expect(
      decide({
        state: state({
          ...quietTokenState,
          last_bombs: 0,
          last_time_to_bomb_seconds: 9000
        }),
        bomb: trustedBomb(NOW, {
          bombsAvailable: 0,
          bombNextInSeconds: 6800
        })
      }).alerts
    ).toEqual(['bomb_prewarn'])
  })

  it('does NOT re-fire while sitting inside the window', () => {
    expect(
      decide({
        state: state({
          ...quietTokenState,
          last_bombs: 0,
          last_time_to_bomb_seconds: 7000
        }),
        bomb: trustedBomb(NOW, { bombsAvailable: 0, bombNextInSeconds: 6800 })
      }).alerts
    ).toEqual([])
  })

  it('respects the 9h hysteresis, not the 6h token one', () => {
    const at = (ms: number) =>
      decide({
        state: state({
          ...quietTokenState,
          last_bombs: 0,
          last_time_to_bomb_seconds: 9000,
          last_bomb_prewarn_alert_at: msAgoFrom(NOW, ms)
        }),
        bomb: trustedBomb(NOW, { bombsAvailable: 0, bombNextInSeconds: 6800 })
      }).alerts

    expect(at(BOMB_PREWARN_REALERT_MS - 60_000)).toEqual([])
    expect(at(BOMB_PREWARN_REALERT_MS + 60_000)).toEqual(['bomb_prewarn'])
    expect(at(PREWARN_REALERT_MS + 60_000)).toEqual([])
  })

  it('does not fire when alert_before_bomb_ready is off', () => {
    expect(
      decide({
        prefs: prefs({ alert_before_bomb_ready: false }),
        state: state({
          ...quietTokenState,
          last_bombs: 0,
          last_time_to_bomb_seconds: 9000
        }),
        bomb: trustedBomb(NOW, { bombsAvailable: 0, bombNextInSeconds: 6800 })
      }).alerts
    ).toEqual([])
  })

  it('never emits a bomb gained alert on a 0 -> 1 rise', () => {
    const result = decide({
      state: state({ ...quietTokenState, last_bombs: 0 }),
      bomb: trustedBomb(NOW, { bombsAvailable: 1, bombNextInSeconds: 0 })
    })
    expect(result.alerts).toEqual(['bomb_ready'])
    expect(result.alerts).toHaveLength(1)
  })
})

describe('at-ceiling pre-warn fires for BOTH resources', () => {
  it('tokens: the 720-minute ceiling still fires after an at-cap observation', () => {
    expect(
      decide({
        prefs: prefs({
          alert_before_full_minutes: MAX_TOKEN_PREWARN_MINUTES,
          alert_on_full: false,
          alert_on_token_gained: false
        }),
        state: state({ last_tokens: 3, last_time_to_full_seconds: 0 }),
        tokens: 2,
        tokenNextInSeconds: TWELVE_HOURS_IN_SECONDS
      }).alerts
    ).toEqual(['prewarn'])
  })

  it('bombs: the 960-minute ceiling fires on a normal crossing', () => {
    expect(
      decide({
        prefs: prefs({
          alert_before_bomb_ready_minutes: MAX_BOMB_PREWARN_MINUTES,
          alert_on_bomb_ready: false
        }),
        state: state({
          ...quietTokenState,
          last_bombs: 0,
          last_time_to_bomb_seconds: EIGHTEEN_HOURS_IN_SECONDS
        }),
        bomb: trustedBomb(NOW, {
          bombsAvailable: 0,
          bombNextInSeconds: MAX_BOMB_PREWARN_MINUTES * 60
        })
      }).alerts
    ).toEqual(['bomb_prewarn'])
  })

  it('bombs: the 960-minute ceiling also fires straight after an at-cap observation', () => {
    expect(
      decide({
        prefs: prefs({
          alert_before_bomb_ready_minutes: MAX_BOMB_PREWARN_MINUTES,
          alert_on_bomb_ready: false
        }),
        state: state({
          ...quietTokenState,
          last_bombs: 1,
          last_time_to_bomb_seconds: 0
        }),
        bomb: trustedBomb(NOW, {
          bombsAvailable: 0,
          bombNextInSeconds: MAX_BOMB_PREWARN_MINUTES * 60 - 1
        })
      }).alerts
    ).toEqual(['bomb_prewarn'])
  })

  it('bombs: a freshly-spent bomb is NOT yet in the ceiling window', () => {
    expect(
      decide({
        prefs: prefs({
          alert_before_bomb_ready_minutes: MAX_BOMB_PREWARN_MINUTES,
          alert_on_bomb_ready: false
        }),
        state: state({
          ...quietTokenState,
          last_bombs: 1,
          last_time_to_bomb_seconds: 0
        }),
        bomb: trustedBomb(NOW, {
          bombsAvailable: 0,
          bombNextInSeconds: EIGHTEEN_HOURS_IN_SECONDS
        })
      }).alerts
    ).toEqual([])
  })
})

describe('precedence — pre_quiet > burn_prewarn > full > prewarn > gained > bombs', () => {
  it('declares the ladder in that order', () => {
    expect([...ALERT_PRECEDENCE]).toEqual([
      'pre_quiet',
      'burn_prewarn',
      'full',
      'prewarn',
      'gained',
      'bomb_ready',
      'bomb_prewarn'
    ])
  })

  it('still does not include the cut burn_imminent type', () => {
    expect(ALERT_PRECEDENCE).not.toContain('burn_imminent')
    expect(Object.keys(ALERT_RESOURCE).sort()).toEqual([
      'bomb_prewarn',
      'bomb_ready',
      'burn_prewarn',
      'full',
      'gained',
      'pre_quiet',
      'prewarn'
    ])
  })

  it('gives the WI-4970 schedule kinds NO resource baseline', () => {
    // 'token' here would let a delivered pre_quiet advance past a crossing a same-tick `full` lost.
    expect(ALERT_RESOURCE.pre_quiet).toBe('none')
    expect(ALERT_RESOURCE.burn_prewarn).toBe('none')
  })

  const everythingQualifies = {
    state: state({
      last_tokens: 2,
      last_time_to_full_seconds: 0,
      last_bombs: 0,
      last_time_to_bomb_seconds: 0
    }),
    tokens: MAX_TOKENS,
    tokenNextInSeconds: 0,
    bomb: trustedBomb(NOW, { bombsAvailable: 1, bombNextInSeconds: 0 })
  }

  it("'full' wins the whole ladder", () => {
    const result = decide({ ...everythingQualifies, prefs: ALL_ON })
    expect(result.alerts).toEqual(['full'])
    expect(result.alerts).toHaveLength(1)
  })

  it("'prewarn' wins once 'full' is disabled", () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full: false }),
        state: state({
          last_tokens: 1,
          last_time_to_full_seconds: 0,
          last_bombs: 0
        }),
        tokens: 2,
        tokenNextInSeconds: 3600,
        bomb: trustedBomb(NOW, { bombsAvailable: 1, bombNextInSeconds: 0 })
      }).alerts
    ).toEqual(['prewarn'])
  })

  it("'gained' wins once 'full' and 'prewarn' are disabled", () => {
    expect(
      decide({
        prefs: prefs({ alert_on_full: false, alert_before_full: false }),
        state: state({
          last_tokens: 1,
          last_time_to_full_seconds: 0,
          last_bombs: 0
        }),
        tokens: 2,
        tokenNextInSeconds: 3600,
        bomb: trustedBomb(NOW, { bombsAvailable: 1, bombNextInSeconds: 0 })
      }).alerts
    ).toEqual(['gained'])
  })

  it("'bomb_ready' wins once every token alert is disabled", () => {
    expect(
      decide({
        ...everythingQualifies,
        prefs: prefs({
          alert_on_full: false,
          alert_before_full: false,
          alert_on_token_gained: false
        })
      }).alerts
    ).toEqual(['bomb_ready'])
  })

  it("'bomb_prewarn' is last", () => {
    expect(
      decide({
        prefs: prefs({
          alert_on_full: false,
          alert_before_full: false,
          alert_on_token_gained: false,
          alert_on_bomb_ready: false
        }),
        state: state({
          ...quietTokenState,
          last_bombs: 0,
          last_time_to_bomb_seconds: 9000
        }),
        bomb: trustedBomb(NOW, { bombsAvailable: 0, bombNextInSeconds: 6800 })
      }).alerts
    ).toEqual(['bomb_prewarn'])
  })

  it('a token alert winning precedence FREEZES a bomb alert that also qualified', () => {
    // Otherwise the bomb alert is eaten and its guard disarmed by the advanced baseline.
    const result = decide({ ...everythingQualifies, prefs: ALL_ON })
    expect(result.alerts).toEqual(['full'])
    expectAdvanced(result.stateWrites.token)
    expectFrozen(result.stateWrites.bomb, 'pending_alert')
  })

  it('advances a resource that had nothing to say', () => {
    const result = decide({
      state: state({ ...quietTokenState, last_bombs: 0 }),
      bomb: trustedBomb(NOW, { bombsAvailable: 1, bombNextInSeconds: 0 })
    })
    expect(result.alerts).toEqual(['bomb_ready'])
    expectAdvanced(result.stateWrites.bomb)
    expectAdvanced(result.stateWrites.token)
  })
})

describe('localHourInZone', () => {
  it('resolves the wall-clock hour in the named zone', () => {
    expect(localHourInZone(NOW, 'UTC')).toBe(12)
    expect(localHourInZone(NOW, ZONE)).toBe(8) // 12:00Z = 08:00 EDT
    expect(localHourInZone(QUIET_NOW, ZONE)).toBe(3) // 07:00Z = 03:00 EDT
  })

  it('returns null for an unknown zone rather than silently using UTC', () => {
    expect(localHourInZone(NOW, 'Mars/Olympus_Mons')).toBeNull()
    expect(localHourInZone(NOW, 'not a zone')).toBeNull()
  })

  it('renders midnight as hour 0, never 24', () => {
    // Some engines emit '24' under hour12:false; the modulo must normalise it.
    expect(localHourInZone(new Date('2026-07-18T04:00:00Z'), ZONE)).toBe(0)
    expect(localHourInZone(new Date('2026-07-18T00:00:00Z'), 'UTC')).toBe(0)
  })
})

describe('resolveQuietHours', () => {
  const OFF = {
    enabled: false,
    active: false,
    configError: null,
    startHour: null,
    endHour: null,
    timeZone: null
  }

  it('is active inside a midnight-wrapping window and inactive outside it', () => {
    expect(resolveQuietHours(quietPrefs(), QUIET_NOW)).toEqual({
      enabled: true,
      active: true,
      configError: null,
      startHour: QUIET_START,
      endHour: QUIET_END,
      timeZone: ZONE
    })
    expect(resolveQuietHours(quietPrefs(), NOW)).toEqual({
      enabled: true,
      active: false,
      configError: null,
      startHour: QUIET_START,
      endHour: QUIET_END,
      timeZone: ZONE
    })
  })

  it('handles a same-day window that does not wrap', () => {
    const p = quietPrefs({ quiet_hours_start: 7, quiet_hours_end: 9 })
    expect(resolveQuietHours(p, NOW).active).toBe(true)
    expect(resolveQuietHours(p, QUIET_NOW).active).toBe(false)
  })

  it('includes the start hour and excludes the end hour', () => {
    expect(
      resolveQuietHours(
        quietPrefs({ quiet_hours_start: 8, quiet_hours_end: 9 }),
        NOW
      ).active
    ).toBe(true)
    expect(
      resolveQuietHours(
        quietPrefs({ quiet_hours_start: 7, quiet_hours_end: 8 }),
        NOW
      ).active
    ).toBe(false)
  })

  it('treats start === end as DISABLED, never as quiet forever', () => {
    // Reversed, every persistent alert would defer forever; an empty window is legal and inert.
    expect(
      resolveQuietHours(
        quietPrefs({ quiet_hours_start: 3, quiet_hours_end: 3 }),
        QUIET_NOW
      )
    ).toEqual(OFF)
  })

  it('is silently off — not an error — when nothing is configured at all', () => {
    expect(resolveQuietHours(prefs(), QUIET_NOW)).toEqual(OFF)
  })

  it('fails OPEN with a configError when the timezone is missing or unusable', () => {
    // A UTC default would DM at 3am local, so an unusable zone disables quiet hours (logged).
    for (const zone of [null, '', '   ', 'Mars/Olympus_Mons']) {
      const resolved = resolveQuietHours(
        quietPrefs({ quiet_hours_timezone: zone }),
        QUIET_NOW
      )
      expect(resolved.enabled).toBe(false)
      expect(resolved.active).toBe(false)
      expect(resolved.configError).toBeTruthy()
    }
  })

  it('fails OPEN with a configError on a partial or out-of-range window', () => {
    for (const partial of [
      { quiet_hours_start: null },
      { quiet_hours_end: null },
      { quiet_hours_start: 24 },
      { quiet_hours_end: -1 },
      { quiet_hours_start: 22.5 }
    ]) {
      const resolved = resolveQuietHours(quietPrefs(partial), QUIET_NOW)
      expect(resolved.enabled).toBe(false)
      expect(resolved.active).toBe(false)
      expect(resolved.configError).toBeTruthy()
    }
  })
})

describe('resolveQuietHours — DST', () => {
  const p = quietPrefs({ quiet_hours_start: 22, quiet_hours_end: 6 })

  it('tracks wall-clock across the EST/EDT offset change', () => {
    expect(resolveQuietHours(p, new Date('2026-01-18T03:00:00Z')).active).toBe(
      true
    )
    expect(resolveQuietHours(p, new Date('2026-07-18T03:00:00Z')).active).toBe(
      true
    )
    expect(resolveQuietHours(p, new Date('2026-01-18T02:30:00Z')).active).toBe(
      false
    )
    expect(resolveQuietHours(p, new Date('2026-07-18T02:30:00Z')).active).toBe(
      true
    )
  })

  it('handles the spring-forward gap (02:00-02:59 local never occurs)', () => {
    const overnight = quietPrefs({
      quiet_hours_start: 1,
      quiet_hours_end: 5
    })
    expect(
      resolveQuietHours(overnight, new Date('2026-03-08T06:30:00Z')).active
    ).toBe(true)
    expect(
      resolveQuietHours(overnight, new Date('2026-03-08T07:30:00Z')).active
    ).toBe(true)
    expect(
      resolveQuietHours(overnight, new Date('2026-03-08T10:30:00Z')).active
    ).toBe(false)
  })

  it('handles the fall-back repeat (01:30 local occurs twice)', () => {
    const overnight = quietPrefs({
      quiet_hours_start: 1,
      quiet_hours_end: 5
    })
    expect(
      resolveQuietHours(overnight, new Date('2026-11-01T05:30:00Z')).active
    ).toBe(true)
    expect(
      resolveQuietHours(overnight, new Date('2026-11-01T06:30:00Z')).active
    ).toBe(true)
  })
})

describe('quiet hours — DEFER freezes, DROP advances', () => {
  it('defers a token full alert and FREEZES the token baseline', () => {
    const result = decide({
      now: QUIET_NOW,
      prefs: quietPrefs(),
      state: state({ last_tokens: 2 }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(result.alerts).toEqual([])
    expect(result.quietHours.action).toBe('defer')
    expect(result.quietHours.suppressed).toBe('full')
    expectFrozen(result.stateWrites.token, 'quiet_hours_defer')
  })

  it('the deferred alert actually fires once quiet hours end', () => {
    const frozen = state({ last_tokens: 2 })
    const deferred = decide({
      now: QUIET_NOW,
      prefs: quietPrefs(),
      state: frozen,
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(deferred.alerts).toEqual([])
    expectFrozen(deferred.stateWrites.token, 'quiet_hours_defer')

    const morning = decide({
      now: NOW,
      prefs: quietPrefs(),
      state: frozen,
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(morning.alerts).toEqual(['full'])
    expect(morning.quietHours.action).toBe('none')
  })

  it('defers prewarn, bomb_ready and bomb_prewarn too', () => {
    const prewarn = decide({
      now: QUIET_NOW,
      prefs: quietPrefs({ alert_on_full: false, alert_on_token_gained: false }),
      state: state({ last_tokens: 2, last_time_to_full_seconds: 20_000 }),
      tokens: 2,
      tokenNextInSeconds: 3600
    })
    expect(prewarn.quietHours).toMatchObject({
      action: 'defer',
      suppressed: 'prewarn'
    })

    const bombReady = decide({
      now: QUIET_NOW,
      prefs: quietPrefs(),
      state: state({ ...quietTokenState, last_bombs: 0 }),
      bomb: trustedBomb(QUIET_NOW, { bombsAvailable: 1, bombNextInSeconds: 0 })
    })
    expect(bombReady.quietHours).toMatchObject({
      action: 'defer',
      suppressed: 'bomb_ready'
    })
    expectFrozen(bombReady.stateWrites.bomb, 'quiet_hours_defer')

    const bombPrewarn = decide({
      now: QUIET_NOW,
      prefs: quietPrefs({ alert_on_bomb_ready: false }),
      state: state({
        ...quietTokenState,
        last_bombs: 0,
        last_time_to_bomb_seconds: 9000
      }),
      bomb: trustedBomb(QUIET_NOW, {
        bombsAvailable: 0,
        bombNextInSeconds: 6800
      })
    })
    expect(bombPrewarn.quietHours).toMatchObject({
      action: 'defer',
      suppressed: 'bomb_prewarn'
    })
    expectFrozen(bombPrewarn.stateWrites.bomb, 'quiet_hours_defer')
  })

  it("DROPS 'gained' and ADVANCES the baseline (no catch-up burst)", () => {
    const result = decide({
      now: QUIET_NOW,
      prefs: quietPrefs({ alert_on_full: false, alert_before_full: false }),
      state: state({ last_tokens: 0, last_time_to_full_seconds: 90_000 }),
      tokens: 1,
      tokenNextInSeconds: 40_000
    })
    expect(result.alerts).toEqual([])
    expect(result.quietHours.action).toBe('drop')
    expect(result.quietHours.suppressed).toBe('gained')
    expectAdvanced(result.stateWrites.token)
  })

  it('a dropped gain is NOT replayed at the end of quiet hours', () => {
    const before = state({ last_tokens: 0, last_time_to_full_seconds: 90_000 })
    const dropped = decide({
      now: QUIET_NOW,
      prefs: quietPrefs({ alert_on_full: false, alert_before_full: false }),
      state: before,
      tokens: 1,
      tokenNextInSeconds: 40_000
    })
    expectAdvanced(dropped.stateWrites.token)

    const advanced = expectAdvanced(dropped.stateWrites.token)
    const after = state({
      last_tokens: advanced.amount,
      last_time_to_full_seconds: advanced.timeToFullSeconds
    })
    const morning = decide({
      now: NOW,
      prefs: quietPrefs({ alert_on_full: false, alert_before_full: false }),
      state: after,
      tokens: 1,
      tokenNextInSeconds: 40_000
    })
    expect(morning.alerts).toEqual([])
  })

  it('does nothing when quiet hours are outside their window', () => {
    const result = decide({
      now: NOW,
      prefs: quietPrefs(),
      state: state({ last_tokens: 2 }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(result.alerts).toEqual(['full'])
    expect(result.quietHours).toMatchObject({
      enabled: true,
      active: false,
      action: 'none',
      suppressed: null,
      deferredSince: null
    })
  })

  it('delivers normally when quiet hours are disabled by start === end', () => {
    expect(
      decide({
        now: QUIET_NOW,
        prefs: quietPrefs({ quiet_hours_start: 3, quiet_hours_end: 3 }),
        state: state({ last_tokens: 2 }),
        tokens: MAX_TOKENS,
        tokenNextInSeconds: 0
      }).alerts
    ).toEqual(['full'])
  })

  it('delivers normally when the timezone is missing', () => {
    expect(
      decide({
        now: QUIET_NOW,
        prefs: quietPrefs({ quiet_hours_timezone: null }),
        state: state({ last_tokens: 2 }),
        tokens: MAX_TOKENS,
        tokenNextInSeconds: 0
      }).alerts
    ).toEqual(['full'])
  })
})

describe('quiet hours — deferredSince bookkeeping', () => {
  it('stamps the first deferral with now', () => {
    const result = decide({
      now: QUIET_NOW,
      prefs: quietPrefs(),
      state: state({ last_tokens: 2, quiet_hours_deferred_since: null }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(result.quietHours.deferredSince).toBe(QUIET_NOW.toISOString())
  })

  it('preserves the original anchor across subsequent deferrals', () => {
    // Re-stamping every tick would make the max-defer valve unreachable.
    const anchor = msAgoFrom(QUIET_NOW, 3 * HOUR_MS)
    const result = decide({
      now: QUIET_NOW,
      prefs: quietPrefs(),
      state: state({ last_tokens: 2, quiet_hours_deferred_since: anchor }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(result.quietHours.deferredSince).toBe(anchor)
  })

  it('clears the anchor when a deferrable alert actually DELIVERS', () => {
    const delivered = decide({
      now: NOW,
      prefs: quietPrefs(),
      state: state({
        last_tokens: 2,
        quiet_hours_deferred_since: msAgoFrom(NOW, HOUR_MS)
      }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(delivered.alerts).toEqual(['full'])
    expect(delivered.quietHours.deferredSince).toBeNull()
  })

  it('clears the anchor once we are OUTSIDE the quiet window, alert or not', () => {
    const idle = decide({
      now: NOW,
      prefs: quietPrefs({ alert_on_full: false, alert_before_full: false }),
      state: state({
        last_tokens: 1,
        last_time_to_full_seconds: 40_000,
        quiet_hours_deferred_since: msAgoFrom(NOW, HOUR_MS)
      }),
      tokens: 1,
      tokenNextInSeconds: 40_000
    })
    expect(idle.alerts).toEqual([])
    expect(idle.quietHours.active).toBe(false)
    expect(idle.quietHours.deferredSince).toBeNull()
  })

  // Clearing on a dropped alert would keep resetting the valve's anchor.
  it('does NOT clear the anchor on a DROPPED alert inside the window', () => {
    const anchor = msAgoFrom(QUIET_NOW, HOUR_MS)
    const dropped = decide({
      now: QUIET_NOW,
      prefs: quietPrefs({ alert_on_full: false, alert_before_full: false }),
      state: state({
        last_tokens: 0,
        last_time_to_full_seconds: 90_000,
        quiet_hours_deferred_since: anchor
      }),
      tokens: 1,
      tokenNextInSeconds: 40_000
    })
    expect(dropped.quietHours.action).toBe('drop')
    expect(dropped.quietHours.deferredSince).toBe(anchor)
  })

  it('does NOT clear the anchor on a no-op tick inside the window', () => {
    const anchor = msAgoFrom(QUIET_NOW, HOUR_MS)
    const noop = decide({
      now: QUIET_NOW,
      prefs: quietPrefs({
        alert_on_full: false,
        alert_before_full: false,
        alert_on_token_gained: false
      }),
      state: state({
        last_tokens: 1,
        last_time_to_full_seconds: 40_000,
        quiet_hours_deferred_since: anchor
      }),
      tokens: 1,
      tokenNextInSeconds: 40_000
    })
    expect(noop.alerts).toEqual([])
    expect(noop.quietHours.action).toBe('none')
    expect(noop.quietHours.deferredSince).toBe(anchor)
  })
})

/** Unreachable in production (window <= 23h), so tests that make it fire inject an anchor. */
describe('quiet hours — max-defer safety valve (structurally unreachable)', () => {
  const deferring = (deferredSince: string | null) =>
    decide({
      now: QUIET_NOW,
      prefs: quietPrefs(),
      state: state({
        last_tokens: 2,
        quiet_hours_deferred_since: deferredSince
      }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })

  it('keeps the anchor at the FIRST defer across a defer/drop run', () => {
    const windowStart = new Date(Date.UTC(2026, 6, 18, 3, 0, 0))
    const firstDeferAt = windowStart.toISOString()

    let anchor: string | null = null
    let lastResult = decide({
      now: windowStart,
      prefs: quietPrefs({ alert_on_token_gained: true }),
      state: state({ last_tokens: 2, quiet_hours_deferred_since: anchor }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(lastResult.quietHours.action).toBe('defer')
    anchor = lastResult.quietHours.deferredSince
    expect(anchor).toBe(firstDeferAt)

    for (let hour = 1; hour <= 3; hour++) {
      const at = new Date(windowStart.getTime() + hour * HOUR_MS)
      const isDropTick = hour % 2 === 1
      const result = decide({
        now: at,
        prefs: quietPrefs({
          alert_on_token_gained: true,
          ...(isDropTick ? { alert_on_full: false } : {})
        }),
        state: state({
          last_tokens: isDropTick ? MAX_TOKENS - 1 : MAX_TOKENS - 1,
          last_time_to_full_seconds: isDropTick ? 40_000 : 0,
          quiet_hours_deferred_since: anchor
        }),
        tokens: MAX_TOKENS,
        tokenNextInSeconds: 0
      })
      expect(result.quietHours.action).toBe(isDropTick ? 'drop' : 'defer')
      anchor = result.quietHours.deferredSince
      expect(anchor).toBe(firstDeferAt)
    }

    const pastCeiling = new Date(
      windowStart.getTime() + QUIET_HOURS_MAX_DEFER_MS + 60_000
    )
    const tripped = decide({
      now: pastCeiling,
      prefs: quietPrefs(),
      state: state({
        last_tokens: MAX_TOKENS - 1,
        quiet_hours_deferred_since: anchor
      }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0
    })
    expect(tripped.quietHours.active).toBe(true)
    expect(tripped.quietHours.maxDeferOverride).toBe(true)
    expect(tripped.alerts).toEqual(['full'])
    expect(tripped.quietHours.deferredSince).toBeNull()
  })

  it('still defers just inside the ceiling', () => {
    const result = deferring(
      msAgoFrom(QUIET_NOW, QUIET_HOURS_MAX_DEFER_MS - 60_000)
    )
    expect(result.alerts).toEqual([])
    expect(result.quietHours.action).toBe('defer')
    expect(result.quietHours.maxDeferOverride).toBe(false)
  })

  it('DELIVERS past the ceiling — an INJECTED anchor no scan loop can produce', () => {
    const result = deferring(
      msAgoFrom(QUIET_NOW, QUIET_HOURS_MAX_DEFER_MS + 60_000)
    )
    expect(result.alerts).toEqual(['full'])
    expect(result.quietHours.action).toBe('none')
    expect(result.quietHours.maxDeferOverride).toBe(true)
    expect(result.quietHours.active).toBe(true)
    expectAdvanced(result.stateWrites.token)
    expect(result.quietHours.deferredSince).toBeNull()
  })

  it('the ceiling is unreachable under the current whole-hour window bounds', () => {
    let widestWindowHours = 0
    for (let start = 0; start <= 23; start++) {
      for (let end = 0; end <= 23; end++) {
        if (start === end) continue
        const hours = start < end ? end - start : 24 - start + end
        widestWindowHours = Math.max(widestWindowHours, hours)
      }
    }
    expect(widestWindowHours).toBe(23)

    expect(widestWindowHours * HOUR_MS).toBeLessThan(QUIET_HOURS_MAX_DEFER_MS)

    // Fall-back DST adds at most one hour, reaching the ceiling only exactly.
    expect((widestWindowHours + 1) * HOUR_MS).toBeLessThanOrEqual(
      QUIET_HOURS_MAX_DEFER_MS
    )

    // On failure, revisit QUIET_HOURS_MAX_DEFER_MS; do not lower it.
  })

  it('never overrides a DROP (a stale gain is still not worth a DM)', () => {
    const result = decide({
      now: QUIET_NOW,
      prefs: quietPrefs({ alert_on_full: false, alert_before_full: false }),
      state: state({
        last_tokens: 0,
        last_time_to_full_seconds: 90_000,
        quiet_hours_deferred_since: msAgoFrom(
          QUIET_NOW,
          QUIET_HOURS_MAX_DEFER_MS + 60_000
        )
      }),
      tokens: 1,
      tokenNextInSeconds: 40_000
    })
    expect(result.alerts).toEqual([])
    expect(result.quietHours.action).toBe('drop')
    expect(result.quietHours.maxDeferOverride).toBe(false)
  })
})

describe('quiet hours — cross-resource freeze isolation', () => {
  it('a deferred TOKEN alert does not freeze an idle bomb baseline', () => {
    const result = decide({
      now: QUIET_NOW,
      prefs: quietPrefs(),
      state: state({
        last_tokens: 2,
        last_bombs: 0,
        last_time_to_bomb_seconds: 40_000
      }),
      tokens: MAX_TOKENS,
      tokenNextInSeconds: 0,
      bomb: trustedBomb(QUIET_NOW, {
        bombsAvailable: 0,
        bombNextInSeconds: 39_000
      })
    })
    expect(result.quietHours.suppressed).toBe('full')
    expectFrozen(result.stateWrites.token, 'quiet_hours_defer')
    expect(expectAdvanced(result.stateWrites.bomb).amount).toBe(0)
  })

  it('a deferred BOMB alert does not freeze an idle token baseline', () => {
    const result = decide({
      now: QUIET_NOW,
      prefs: quietPrefs(),
      state: state({ ...quietTokenState, last_bombs: 0 }),
      bomb: trustedBomb(QUIET_NOW, { bombsAvailable: 1, bombNextInSeconds: 0 })
    })
    expect(result.quietHours.suppressed).toBe('bomb_ready')
    expectFrozen(result.stateWrites.bomb, 'quiet_hours_defer')
    expectAdvanced(result.stateWrites.token)
  })

  it('a DROPPED token gain does not disturb a bomb alert deferred behind it', () => {
    const result = decide({
      now: QUIET_NOW,
      prefs: quietPrefs({ alert_on_full: false, alert_before_full: false }),
      state: state({
        last_tokens: 0,
        last_time_to_full_seconds: 90_000,
        last_bombs: 0
      }),
      tokens: 1,
      tokenNextInSeconds: 40_000,
      bomb: trustedBomb(QUIET_NOW, { bombsAvailable: 1, bombNextInSeconds: 0 })
    })
    expect(result.quietHours.action).toBe('drop')
    expect(result.quietHours.suppressed).toBe('gained')
    expectAdvanced(result.stateWrites.token)
    expectFrozen(result.stateWrites.bomb, 'pending_alert')
  })
})

describe('at most one alert per tick', () => {
  it('holds across a grid of token x bomb x quiet-hours states', () => {
    let sawBomb = false
    let sawToken = false
    for (const tokens of [0, 1, 2, 3]) {
      for (const lastTokens of [null, 0, 1, 2, 3]) {
        for (const bombs of [0, 1]) {
          for (const lastBombs of [null, 0, 1]) {
            for (const now of [NOW, QUIET_NOW]) {
              const result = decide({
                now,
                prefs: quietPrefs(),
                state: state({
                  last_tokens: lastTokens,
                  last_time_to_full_seconds: 0,
                  last_bombs: lastBombs,
                  last_time_to_bomb_seconds: 0
                }),
                tokens,
                tokenNextInSeconds: 3600,
                bomb: trustedBomb(now, {
                  bombsAvailable: bombs,
                  bombNextInSeconds: bombs === 1 ? 0 : 6800
                })
              })
              expect(result.alerts.length).toBeLessThanOrEqual(1)
              const alert = result.alerts[0]
              if (alert != null) {
                if (ALERT_RESOURCE[alert] === 'bomb') sawBomb = true
                else sawToken = true
              }
            }
          }
        }
      }
    }
    expect(sawToken).toBe(true)
    expect(sawBomb).toBe(true)
  })
})

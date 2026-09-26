/** Differential gate against the frozen token-only original (decision-core-v0-frozen.ts). */

import { describe, expect, it } from 'vitest'
import { decideAlerts } from '@/app/lib/token-alerts/decision-core'
import { decideAlertsV0 } from '@/tests/unit/token-alerts/decision-core-v0-frozen'
import type {
  UserTokenAlertPrefs,
  UserTokenAlertState
} from '@/app/lib/token-alerts/types'

const NOW = new Date('2026-07-18T12:00:00.000Z')
const msAgo = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOKEN_VALUES = [-5, -1, 0, 1, 2, 3, 4, 99]

/** Flanks the 120-minute window (7200) and one regen cycle (43200). */
const NEXT_VALUES: Array<number | null> = [
  null,
  -600,
  0,
  1,
  600,
  7199,
  7200,
  7201,
  43199,
  43200,
  43201,
  86400
]

const PREWARN_MINUTES = [15, 30, 120, 719, 720]

const LAST_TOKENS: Array<number | null> = [null, 0, 1, 2, 3]

const LAST_TTF: Array<number | null> = [
  null,
  0,
  1,
  7199,
  7200,
  7201,
  43200,
  43201,
  90000
]

const ALERT_AGES: Array<string | null> = [
  null,
  'not-a-timestamp',
  msAgo(0),
  msAgo(55 * 60 * 1000 - 1),
  msAgo(55 * 60 * 1000),
  msAgo(55 * 60 * 1000 + 1),
  msAgo(6 * 60 * 60 * 1000 - 1),
  msAgo(6 * 60 * 60 * 1000),
  msAgo(6 * 60 * 60 * 1000 + 1),
  msAgo(11 * 60 * 60 * 1000 - 1),
  msAgo(11 * 60 * 60 * 1000),
  msAgo(11 * 60 * 60 * 1000 + 1),
  msAgo(72 * 60 * 60 * 1000)
]

const BOOLS = [false, true]

interface Sample {
  prefs: UserTokenAlertPrefs
  state: UserTokenAlertState | null
  tokens: number
  tokenNextInSeconds: number | null
}

function buildState(overrides: Partial<UserTokenAlertState>) {
  return {
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
  } satisfies UserTokenAlertState
}

function randomSample(rand: () => number): Sample {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
  const hasState = rand() < 0.85
  return {
    prefs: {
      user_id: 'user-1',
      alert_on_full: pick(BOOLS),
      // Repeat cadence disabled to keep the v0 comparison apples-to-apples.
      alert_on_full_repeat_hours: null,
      alert_before_full: pick(BOOLS),
      alert_before_full_minutes: pick(PREWARN_MINUTES),
      alert_on_token_gained: pick(BOOLS)
    },
    state: hasState
      ? buildState({
          last_tokens: pick(LAST_TOKENS),
          last_time_to_full_seconds: pick(LAST_TTF),
          last_full_alert_at: pick(ALERT_AGES),
          last_prewarn_alert_at: pick(ALERT_AGES),
          last_gain_alert_at: pick(ALERT_AGES)
        })
      : null,
    tokens: pick(TOKEN_VALUES),
    tokenNextInSeconds: pick(NEXT_VALUES)
  }
}

function compare(sample: Sample) {
  const expected = decideAlertsV0({ now: NOW, ...sample })
  const actual = decideAlerts({ now: NOW, ...sample })
  return { expected, actual }
}

function describeSample(sample: Sample): string {
  return JSON.stringify(sample)
}

describe('decision-core differential — generalized vs frozen WI-3990', () => {
  it('agrees with the frozen implementation on 25,000 randomized inputs', () => {
    const rand = mulberry32(0x5eed4000)
    let checked = 0
    for (let i = 0; i < 25_000; i++) {
      const sample = randomSample(rand)
      const { expected, actual } = compare(sample)
      if (
        JSON.stringify(actual.alerts) !== JSON.stringify(expected.alerts) ||
        JSON.stringify(actual.observed) !== JSON.stringify(expected.observed)
      ) {
        throw new Error(
          `Divergence on ${describeSample(sample)}\n` +
            `  frozen : ${JSON.stringify(expected)}\n` +
            `  actual : ${JSON.stringify({ alerts: actual.alerts, observed: actual.observed })}`
        )
      }
      checked++
    }
    expect(checked).toBe(25_000)
  })

  it('agrees on an exhaustive boundary sweep of readings x prefs x baselines', () => {
    let checked = 0
    for (const tokens of TOKEN_VALUES) {
      for (const tokenNextInSeconds of NEXT_VALUES) {
        for (const minutes of PREWARN_MINUTES) {
          for (const lastTokens of LAST_TOKENS) {
            for (const lastTtf of LAST_TTF) {
              const sample: Sample = {
                prefs: {
                  user_id: 'user-1',
                  alert_on_full: true,
                  alert_before_full: true,
                  alert_before_full_minutes: minutes,
                  alert_on_token_gained: true
                },
                state: buildState({
                  last_tokens: lastTokens,
                  last_time_to_full_seconds: lastTtf
                }),
                tokens,
                tokenNextInSeconds
              }
              const { expected, actual } = compare(sample)
              expect(
                { alerts: actual.alerts, observed: actual.observed },
                describeSample(sample)
              ).toEqual({
                alerts: expected.alerts,
                observed: expected.observed
              })
              checked++
            }
          }
        }
      }
    }
    expect(checked).toBe(21_600)
  })

  it('agrees across every pref-toggle combination at each hysteresis boundary', () => {
    let checked = 0
    for (const onFull of BOOLS) {
      for (const beforeFull of BOOLS) {
        for (const onGained of BOOLS) {
          for (const fullAt of ALERT_AGES) {
            for (const prewarnAt of ALERT_AGES) {
              for (const gainAt of ALERT_AGES) {
                const sample: Sample = {
                  prefs: {
                    user_id: 'user-1',
                    alert_on_full: onFull,
                    alert_before_full: beforeFull,
                    alert_before_full_minutes: 120,
                    alert_on_token_gained: onGained
                  },
                  state: buildState({
                    last_tokens: 2,
                    last_time_to_full_seconds: 43200,
                    last_full_alert_at: fullAt,
                    last_prewarn_alert_at: prewarnAt,
                    last_gain_alert_at: gainAt
                  }),
                  tokens: 3,
                  tokenNextInSeconds: 0
                }
                const { expected, actual } = compare(sample)
                expect(actual.alerts, describeSample(sample)).toEqual(
                  expected.alerts
                )
                checked++
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(17_576)
  })

  it('agrees on a null state (first-ever scan) across every reading', () => {
    for (const tokens of TOKEN_VALUES) {
      for (const tokenNextInSeconds of NEXT_VALUES) {
        const sample: Sample = {
          prefs: {
            user_id: 'user-1',
            alert_on_full: true,
            alert_before_full: true,
            alert_before_full_minutes: 120,
            alert_on_token_gained: true
          },
          state: null,
          tokens,
          tokenNextInSeconds
        }
        const { expected, actual } = compare(sample)
        expect(
          { alerts: actual.alerts, observed: actual.observed },
          describeSample(sample)
        ).toEqual({ alerts: expected.alerts, observed: expected.observed })
      }
    }
  })

  it('the randomized grid actually reaches every token alert type', () => {
    // Guards against vacuity: an all-[] grid would agree with any implementation.
    const rand = mulberry32(0x5eed4000)
    const seen = new Set<string>()
    for (let i = 0; i < 25_000; i++) {
      const sample = randomSample(rand)
      seen.add(decideAlertsV0({ now: NOW, ...sample }).alerts[0] ?? 'none')
    }
    expect([...seen].sort()).toEqual(['full', 'gained', 'none', 'prewarn'])
  })
})

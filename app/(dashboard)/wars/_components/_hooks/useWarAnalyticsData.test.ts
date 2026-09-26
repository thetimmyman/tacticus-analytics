import { describe, it, expect } from 'vitest'
import {
  isAttemptWin,
  type AttemptRow
} from '@/app/(dashboard)/wars/_components/_hooks/useWarAnalyticsData'

// Win rates use defender-HP ground truth, not `attempt_result` ('win' for failed partial attacks).

const baseAttempt = (overrides: Partial<AttemptRow>): AttemptRow => ({
  war_id: 'war-1',
  player_id: 'player-1',
  player_name: 'Player One',
  is_guild_member: true,
  zone_id: 'zone-1',
  damage_dealt: 5000,
  score_earned: 0,
  attempt_result: null,
  attempt_status: null,
  attacker_units_lost: null,
  attempt_end_time: null,
  ...overrides
})

describe('isAttemptWin', () => {
  it('counts a failed partial-damage attack (score > 0, intact defenders, attempt_result=win) as a LOSS', () => {
    const attempt = baseAttempt({
      attempt_result: 'win',
      score_earned: 42,
      defender_units_json: [{ remainingHPAfter: 1200 }, { remainingHPAfter: 0 }]
    })
    expect(isAttemptWin(attempt)).toBe(false)
  })

  it('counts a full defender wipe as a win', () => {
    const attempt = baseAttempt({
      attempt_result: 'win',
      score_earned: 120,
      defender_units_json: [{ remainingHPAfter: 0 }, {}]
    })
    expect(isAttemptWin(attempt)).toBe(true)
  })

  it('always counts attempt_result=loss as a loss', () => {
    const attempt = baseAttempt({
      attempt_result: 'loss',
      defender_units_json: [{ remainingHPAfter: 0 }]
    })
    expect(isAttemptWin(attempt)).toBe(false)
  })

  it('falls back to attacker team-wipe when defender data is missing', () => {
    const wiped = baseAttempt({
      attempt_result: 'win',
      attacker_units_json: [{}, {}]
    })
    expect(isAttemptWin(wiped)).toBe(false)

    const survived = baseAttempt({
      attempt_result: 'win',
      attacker_units_json: [{ remainingHPAfter: 350 }, {}]
    })
    expect(isAttemptWin(survived)).toBe(true)
  })

  it('treats no defender data and no attacker lineup as a win (benefit of the doubt, matches scoring path)', () => {
    const attempt = baseAttempt({ attempt_result: 'win' })
    expect(isAttemptWin(attempt)).toBe(true)
  })

  it('counts a NO-SIGNAL row (null attempt_result, no defender/attacker JSON) as a non-win — win rates must not inflate', () => {
    // Without the completeness guard this row would count as a win.
    const attempt = baseAttempt({
      attempt_result: null,
      score_earned: 15
    })
    expect(isAttemptWin(attempt)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { validateSavedPlan } from '@/app/api/guild-raid/season-plan/validation'

type Tokens = {
  tokensAvailable: number
  tokensSpent: number
  tokensHeld: number
}
const start = '2026-10-01T00:00:00.000Z'
const end = '2026-10-15T00:00:00.000Z'
const at = '2026-10-02T00:00:00.000Z'

function savedPlan(sessions: Tokens[], totalSpent: number) {
  const encounter = {
    stageCode: 'L1',
    loopIndex: 0,
    bossName: 'Synthetic Boss',
    maxHp: 100,
    remainingHp: 100
  }
  return {
    season_id: 'synthetic-config',
    start_at: start,
    end_at: end,
    snapshot_at: at,
    plan: {
      season: '101',
      season_id: 'synthetic-config',
      season_start_at: start,
      season_end_at: end,
      snapshot_at: at,
      time_zone: 'UTC',
      lookback_days: 30,
      sessions_per_day: 1,
      snapshot: {
        guildCode: 'TEST',
        season: '101',
        seasonId: 'synthetic-config',
        snapshotAt: at
      },
      plan: {
        // Matching action counts and aggregate totals isolate the session budget.
        sessions: sessions.map((tokens, index) => ({
          at,
          playerId: `SyntheticPlayer${index + 1}`,
          ...tokens,
          actions: Array.from({ length: tokens.tokensSpent }, () => ({
            type: 'token_attack',
            at,
            playerId: `SyntheticPlayer${index + 1}`,
            ...encounter,
            encounterId: 0,
            expectedDamage: 0,
            appliedDamage: 0,
            overkillDamage: 0
          }))
        })),
        finalRaidState: {
          stageCode: 'L1',
          loopIndex: 0,
          encounters: {
            0: { ...encounter, encounterId: 0 },
            1: { ...encounter, encounterId: 1 },
            2: { ...encounter, encounterId: 2 }
          }
        },
        metrics: {
          tokensSpent: totalSpent,
          overkillDamage: 0,
          bossesDefeated: 0,
          loopAdvances: 0,
          wastedTokens: 0,
          wastedTicks: 0
        },
        warnings: []
      }
    }
  }
}

describe('saved-plan session token budget', () => {
  it('refuses a token attack when the session has no available tokens even if aggregate counts match', () => {
    const value = savedPlan(
      [{ tokensAvailable: 0, tokensSpent: 1, tokensHeld: 0 }],
      1
    )
    expect(() => validateSavedPlan(value, 'TEST')).toThrowError(
      'Invalid planned session'
    )
  })
  it('refuses holding all three tokens after spending one even if aggregate counts match', () => {
    const value = savedPlan(
      [{ tokensAvailable: 3, tokensSpent: 1, tokensHeld: 3 }],
      1
    )
    expect(() => validateSavedPlan(value, 'TEST')).toThrowError(
      'Invalid planned session'
    )
  })
  it.each([
    { tokensAvailable: 0, tokensSpent: 0, tokensHeld: 0 },
    { tokensAvailable: 1, tokensSpent: 0, tokensHeld: 1 },
    { tokensAvailable: 1, tokensSpent: 1, tokensHeld: 0 },
    { tokensAvailable: 2, tokensSpent: 0, tokensHeld: 2 },
    { tokensAvailable: 2, tokensSpent: 1, tokensHeld: 1 },
    { tokensAvailable: 2, tokensSpent: 2, tokensHeld: 0 },
    { tokensAvailable: 3, tokensSpent: 0, tokensHeld: 3 },
    { tokensAvailable: 3, tokensSpent: 1, tokensHeld: 2 },
    { tokensAvailable: 3, tokensSpent: 2, tokensHeld: 1 },
    { tokensAvailable: 3, tokensSpent: 3, tokensHeld: 0 }
  ])(
    'preserves a feasible session without changing its tokens: %j',
    (tokens) => {
      const value = savedPlan([tokens], tokens.tokensSpent)
      expect(validateSavedPlan(value, 'TEST').plan.plan.sessions).toEqual(
        value.plan.plan.sessions
      )
    }
  )
  it.each([
    { tokensAvailable: 3, tokensSpent: 4, tokensHeld: 0 },
    { tokensAvailable: 0, tokensSpent: 0, tokensHeld: 1 },
    { tokensAvailable: 3, tokensSpent: 0, tokensHeld: 2 },
    { tokensAvailable: 3, tokensSpent: 2, tokensHeld: 0 },
    { tokensAvailable: 2, tokensSpent: 1, tokensHeld: 0 },
    { tokensAvailable: 3, tokensSpent: 3, tokensHeld: 1 }
  ])(
    'refuses an impossible session despite matching aggregate totals: %j',
    (tokens) => {
      expect(() =>
        validateSavedPlan(savedPlan([tokens], tokens.tokensSpent), 'TEST')
      ).toThrowError('Invalid planned session')
    }
  )
  it.each([
    { tokensAvailable: 0, tokensSpent: 1, tokensHeld: 0 },
    { tokensAvailable: 3, tokensSpent: 1, tokensHeld: 3 }
  ])('checks an invalid later session independently: %j', (tokens) => {
    const value = savedPlan(
      [{ tokensAvailable: 0, tokensSpent: 0, tokensHeld: 0 }, tokens],
      1
    )
    expect(() => validateSavedPlan(value, 'TEST')).toThrowError(
      'Invalid planned session'
    )
  })
  it('preserves independent valid budgets across multiple sessions', () => {
    const value = savedPlan(
      [
        { tokensAvailable: 3, tokensSpent: 2, tokensHeld: 1 },
        { tokensAvailable: 1, tokensSpent: 1, tokensHeld: 0 },
        { tokensAvailable: 0, tokensSpent: 0, tokensHeld: 0 }
      ],
      3
    )
    expect(validateSavedPlan(value, 'TEST').plan.plan.sessions).toEqual(
      value.plan.plan.sessions
    )
  })
})

// The RPC's per-player gating is covered by season-forecast-forbidden.test.ts.

import { describe, it, expect } from 'vitest'
import {
  computeForecastTokenContract,
  computeLapProjection,
  computePerPlayer
} from '@/app/lib/season-forecast/forecast-math'

describe('WI-1840 forecast token contract', () => {
  it('names current, future, current-lap, and inclusive capacity quantities', () => {
    const contract = computeForecastTokenContract({
      tokensAvailableNow: 34,
      tokensExpectedToRegenerate: 138,
      tokensSpentCurrentLap: 24
    })

    expect(contract).toEqual({
      tokens_available_now: 34,
      tokens_expected_to_regenerate: 138,
      tokens_remaining_from_now: 172,
      tokens_spent_current_lap: 24,
      season_capacity_including_past_spend: 196
    })
  })

  it('feeds lap projection with future-only remaining tokens, avoiding double subtraction', () => {
    const contract = computeForecastTokenContract({
      tokensAvailableNow: 34,
      tokensExpectedToRegenerate: 126,
      tokensSpentCurrentLap: 24
    })

    expect(contract.tokens_remaining_from_now).toBe(160)
    expect(contract.season_capacity_including_past_spend).toBe(184)

    const result = computeLapProjection({
      tokensCapacity: contract.tokens_remaining_from_now,
      tokensIntoCurrentLap: contract.tokens_spent_current_lap,
      projectedLapCost: 125,
      currentLap: 6,
      completedLapCount: 2,
      solverDataAvailable: false
    })

    expect(result).not.toBeNull()
    expect(result!.projectedFinishLap).toBe(6)
    expect(result!.projectedFinishPct).toBeCloseTo(0.47, 2)
  })

  it('clamps junk contract inputs to zero before deriving totals', () => {
    const contract = computeForecastTokenContract({
      tokensAvailableNow: -2,
      tokensExpectedToRegenerate: Number.NaN,
      tokensSpentCurrentLap: -9
    })

    expect(contract).toEqual({
      tokens_available_now: 0,
      tokens_expected_to_regenerate: 0,
      tokens_remaining_from_now: 0,
      tokens_spent_current_lap: 0,
      season_capacity_including_past_spend: 0
    })
  })
})

describe('WI-766 forecast math — computeLapProjection', () => {
  it('worked scenario: Lap 6 + 47%', () => {
    const result = computeLapProjection({
      tokensCapacity: 160,
      tokensIntoCurrentLap: 24,
      projectedLapCost: 125,
      currentLap: 6,
      completedLapCount: 2,
      solverDataAvailable: false
    })

    expect(result).not.toBeNull()
    expect(result!.projectedFinishLap).toBe(6)
    expect(result!.projectedFinishPct).toBeCloseTo(0.47, 2)
    expect(result!.basis).toBe('last_n_laps')
    expect(result!.confidence).toBe('medium')
  })

  it('returns null when no completed laps', () => {
    const result = computeLapProjection({
      tokensCapacity: 100,
      tokensIntoCurrentLap: 0,
      projectedLapCost: 0,
      currentLap: 0,
      completedLapCount: 0,
      solverDataAvailable: false
    })
    expect(result).toBeNull()
  })

  it('capacity exhausted mid-current-lap → finish lands inside in-progress bar', () => {
    // 50 spent + 30 future of a 200 lap cost → "Lap 4 + 40%".
    const result = computeLapProjection({
      tokensCapacity: 30,
      tokensIntoCurrentLap: 50,
      projectedLapCost: 200,
      currentLap: 5,
      completedLapCount: 3,
      solverDataAvailable: false
    })

    expect(result).not.toBeNull()
    expect(result!.projectedFinishLap).toBe(4)
    expect(result!.projectedFinishPct).toBeCloseTo(0.4, 2)
  })

  it('basis flips to wi737_solver when WI-737 has medians for current loop', () => {
    const result = computeLapProjection({
      tokensCapacity: 160,
      tokensIntoCurrentLap: 24,
      projectedLapCost: 125,
      currentLap: 6,
      completedLapCount: 4,
      solverDataAvailable: true
    })

    expect(result).not.toBeNull()
    expect(result!.basis).toBe('wi737_solver')
    expect(result!.confidence).toBe('high')
  })

  it('clamps partial below 1.0 to avoid "Lap N + 100%" rendering edge case', () => {
    // Partial clamps to 0.999 so the label never reads "Lap N + 100%".
    const result = computeLapProjection({
      tokensCapacity: 250, // covers (125 - 0) + 125 exactly
      tokensIntoCurrentLap: 0,
      projectedLapCost: 125,
      currentLap: 3,
      completedLapCount: 2,
      solverDataAvailable: false
    })

    expect(result).not.toBeNull()
    expect(result!.projectedFinishLap).toBe(3)
    expect(result!.projectedFinishPct).toBeLessThan(1)
    expect(result!.projectedFinishPct).toBeGreaterThanOrEqual(0.999)
  })
})

describe('WI-766 forecast math — computePerPlayer', () => {
  const SECONDS_60H = 60 * 60 * 60
  const SECONDS_12H = 12 * 60 * 60

  it('happy path: 1 token now, next in 1h, 60h remaining → 4 will regen, capped at headroom', () => {
    const r = computePerPlayer(
      { tokensNow: 1, nextTokenSeconds: 3600, timeOverCapSeconds: 0 },
      SECONDS_60H
    )
    // 5 cycles fit, but headroom = MAX_TOKENS - 1 = 2.
    expect(r.tokensWillRegen).toBe(2)
    expect(r.tokensAtSeasonEnd).toBe(3)
  })

  it("returns 0 when next token won't arrive before season end", () => {
    const r = computePerPlayer(
      {
        tokensNow: 0,
        nextTokenSeconds: SECONDS_12H + 1000,
        timeOverCapSeconds: 0
      },
      SECONDS_12H
    )
    expect(r.tokensWillRegen).toBe(0)
    expect(r.tokensAtSeasonEnd).toBe(0)
  })

  it('will_cap requires both reaching cap AND historic over-cap (heuristic)', () => {
    const noHistory = computePerPlayer(
      { tokensNow: 2, nextTokenSeconds: 3600, timeOverCapSeconds: 0 },
      SECONDS_60H
    )
    expect(noHistory.tokensAtSeasonEnd).toBe(3)
    expect(noHistory.willCap).toBe(false)

    const withHistory = computePerPlayer(
      { tokensNow: 2, nextTokenSeconds: 3600, timeOverCapSeconds: 7200 },
      SECONDS_60H
    )
    expect(withHistory.tokensAtSeasonEnd).toBe(3)
    expect(withHistory.willCap).toBe(true)
  })

  it('estimated_cap_waste = theoretical - actual', () => {
    const r = computePerPlayer(
      { tokensNow: 2, nextTokenSeconds: 3600, timeOverCapSeconds: 1 },
      SECONDS_60H
    )
    expect(r.tokensWillRegen).toBe(1) // headroom = MAX_TOKENS(3) - 2 = 1
    expect(r.estimatedCapWaste).toBe(4) // theoretical 5 - actual 1
  })

  it('zero remaining time → zero regen, zero waste', () => {
    const r = computePerPlayer(
      { tokensNow: 0, nextTokenSeconds: 0, timeOverCapSeconds: 0 },
      0
    )
    expect(r.tokensWillRegen).toBe(0)
    expect(r.estimatedCapWaste).toBe(0)
  })
})

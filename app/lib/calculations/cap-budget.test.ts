import { describe, it, expect } from 'vitest'
import {
  ageResourceSnapshot,
  BOMB_REGEN_SECONDS,
  BOMB_RESOURCE,
  computeCapBudget,
  formatCapClock,
  seasonMaxForWindow,
  TOKEN_REGEN_SECONDS
} from '@/app/lib/calculations/cap-budget'

const H = 3600
const DAY = 24 * H

describe('computeCapBudget', () => {
  it('reports the slack after the last reachable regeneration', () => {
    const result = computeCapBudget({
      bankNow: 1,
      nextRegenSeconds: 6 * H,
      secondsToDeadline: 6 * H + 3 * TOKEN_REGEN_SECONDS + 2 * H,
      used: 5
    })

    expect(result.status).toBe('regenerating')
    expect(result.regensBeforeDeadline).toBe(4)
    expect(result.capBudgetSeconds).toBe(2 * H)
  })

  it('holds the budget steady as a regenerating player approaches the next token', () => {
    // Below the cap both clocks fall together, so the budget must not move.
    const base = {
      bankNow: 1,
      used: 5,
      nextRegenSeconds: 6 * H,
      secondsToDeadline: 5 * DAY + 90 * 60
    }
    const now = computeCapBudget(base)
    const inOneHour = computeCapBudget({
      ...base,
      nextRegenSeconds: base.nextRegenSeconds - H,
      secondsToDeadline: base.secondsToDeadline - H
    })

    expect(inOneHour.capBudgetSeconds).toBe(now.capBudgetSeconds)
    expect(inOneHour.regensBeforeDeadline).toBe(now.regensBeforeDeadline)
  })

  it('ticks the budget down while the player sits at the cap', () => {
    const atCap = computeCapBudget({
      bankNow: 3,
      nextRegenSeconds: null,
      secondsToDeadline: 5 * DAY + 90 * 60,
      used: 5
    })
    const anHourLater = computeCapBudget({
      bankNow: 3,
      nextRegenSeconds: null,
      secondsToDeadline: 5 * DAY + 90 * 60 - H,
      used: 5
    })

    expect(atCap.status).toBe('at_cap')
    expect(anHourLater.capBudgetSeconds).toBe(
      (atCap.capBudgetSeconds as number) - H
    )
  })

  it('resets to a full interval and drops a regeneration when the budget runs out', () => {
    const onTheLine = computeCapBudget({
      bankNow: 3,
      nextRegenSeconds: null,
      secondsToDeadline: TOKEN_REGEN_SECONDS + 1,
      used: 5
    })
    expect(onTheLine.capBudgetSeconds).toBe(1)
    expect(onTheLine.regensBeforeDeadline).toBe(1)

    const past = computeCapBudget({
      bankNow: 3,
      nextRegenSeconds: null,
      secondsToDeadline: TOKEN_REGEN_SECONDS - 1,
      used: 5
    })
    expect(past.regensBeforeDeadline).toBe(0)
    expect(past.capBudgetSeconds).toBe(0)
  })

  it('bounds still-reachable by the season cap', () => {
    const result = computeCapBudget({
      bankNow: 3,
      nextRegenSeconds: null,
      secondsToDeadline: 30 * DAY,
      used: 20,
      seasonMax: 28
    })

    expect(result.regensBeforeDeadline).toBeGreaterThan(28)
    expect(result.stillReachable).toBe(28)
    expect(result.seasonMax).toBe(28)
  })

  it('counts spent + banked + still-regenerating toward still-reachable', () => {
    const result = computeCapBudget({
      bankNow: 2,
      nextRegenSeconds: 6 * H,
      secondsToDeadline: 6 * H + 3 * TOKEN_REGEN_SECONDS,
      used: 5
    })

    expect(result.regensBeforeDeadline).toBe(4)
    expect(result.stillReachable).toBe(5 + 2 + 4)
  })

  it('returns nulls rather than zeros when the regeneration clock is unknown', () => {
    // No clock: unknowable, not exhausted (0 would falsely warn the player).
    const result = computeCapBudget({
      bankNow: 1,
      nextRegenSeconds: null,
      secondsToDeadline: 5 * DAY,
      used: 5
    })

    expect(result.status).toBe('regenerating')
    expect(result.capBudgetSeconds).toBeNull()
    expect(result.regensBeforeDeadline).toBeNull()
    expect(result.stillReachable).toBeNull()
  })

  it('zeroes the budget when no further regeneration fits before the deadline', () => {
    const result = computeCapBudget({
      bankNow: 3,
      nextRegenSeconds: null,
      secondsToDeadline: H,
      used: 25
    })

    expect(result.regensBeforeDeadline).toBe(0)
    expect(result.capBudgetSeconds).toBe(0)
    expect(result.stillReachable).toBe(28)
  })

  it('reports season_ended past the deadline', () => {
    const result = computeCapBudget({
      bankNow: 2,
      nextRegenSeconds: 4 * H,
      secondsToDeadline: -60,
      used: 24
    })

    expect(result.status).toBe('season_ended')
    expect(result.capBudgetSeconds).toBe(0)
    expect(result.stillReachable).toBe(26)
  })

  it('clamps an out-of-range bank instead of propagating it', () => {
    const result = computeCapBudget({
      bankNow: 9,
      nextRegenSeconds: 4 * H,
      secondsToDeadline: 2 * DAY,
      used: -3
    })

    expect(result.status).toBe('at_cap')
    expect(result.stillReachable).toBe(3 + (result.regensBeforeDeadline ?? 0))
  })
})

describe('computeCapBudget — bombs', () => {
  it('treats a full bomb bank as at-cap and burns against the 18h interval', () => {
    const result = computeCapBudget({
      bankNow: 1,
      nextRegenSeconds: null,
      secondsToDeadline: 2 * BOMB_REGEN_SECONDS + 3 * H,
      used: 4,
      resource: BOMB_RESOURCE
    })

    expect(result.status).toBe('at_cap')
    expect(result.regensBeforeDeadline).toBe(2)
    expect(result.capBudgetSeconds).toBe(3 * H)
    expect(result.stillReachable).toBe(4 + 1 + 2)
  })

  it('uses the remaining cooldown as the clock while the bomb is spent', () => {
    const result = computeCapBudget({
      bankNow: 0,
      nextRegenSeconds: 5 * H,
      secondsToDeadline: 5 * H + 3 * BOMB_REGEN_SECONDS + 30 * 60,
      used: 4,
      resource: BOMB_RESOURCE
    })

    expect(result.status).toBe('regenerating')
    expect(result.regensBeforeDeadline).toBe(4)
    expect(result.capBudgetSeconds).toBe(30 * 60)
    expect(result.stillReachable).toBe(4 + 0 + 4)
  })

  it('falls back to the bomb season cap, not the token one', () => {
    const result = computeCapBudget({
      bankNow: 1,
      nextRegenSeconds: null,
      secondsToDeadline: 60 * DAY,
      used: 4,
      resource: BOMB_RESOURCE
    })

    expect(result.seasonMax).toBe(18)
    expect(result.stillReachable).toBe(18)
  })
})

describe('formatCapClock', () => {
  it('zero-pads to HH:MM:SS', () => {
    expect(formatCapClock(6 * H + 32 * 60 + 42)).toBe('06:32:42')
    expect(formatCapClock(0)).toBe('00:00:00')
    expect(formatCapClock(59)).toBe('00:00:59')
  })

  it('renders a placeholder for unknown or negative input', () => {
    expect(formatCapClock(null)).toBe('--')
    expect(formatCapClock(undefined)).toBe('--')
    expect(formatCapClock(Number.NaN)).toBe('--')
    expect(formatCapClock(-5)).toBe('00:00:00')
  })
})

describe('ageResourceSnapshot', () => {
  it('ages the countdown by the elapsed time without touching the bank', () => {
    const aged = ageResourceSnapshot(1, 6 * H, 90)
    expect(aged.bankNow).toBe(1)
    expect(aged.nextRegenSeconds).toBe(6 * H - 90)
  })

  it('rolls a landed token into the bank and restarts the clock', () => {
    const aged = ageResourceSnapshot(1, 30, 45)
    expect(aged.bankNow).toBe(2)
    expect(aged.nextRegenSeconds).toBe(TOKEN_REGEN_SECONDS - 15)
  })

  it('rolls multiple landed tokens across long gaps', () => {
    const aged = ageResourceSnapshot(0, 30, TOKEN_REGEN_SECONDS + 60)
    expect(aged.bankNow).toBe(2)
    expect(aged.nextRegenSeconds).toBe(TOKEN_REGEN_SECONDS - 30)
  })

  it('stops the clock when rollover fills the bank to the cap', () => {
    const aged = ageResourceSnapshot(2, 30, 120)
    expect(aged.bankNow).toBe(3)
    expect(aged.nextRegenSeconds).toBeNull()
  })

  it('reports a paused clock at the cap regardless of the stale countdown', () => {
    const aged = ageResourceSnapshot(3, 500, 60)
    expect(aged.bankNow).toBe(3)
    expect(aged.nextRegenSeconds).toBeNull()
  })

  it('stays unknowable without a clock rather than inventing one', () => {
    const aged = ageResourceSnapshot(1, null, 600)
    expect(aged.bankNow).toBe(1)
    expect(aged.nextRegenSeconds).toBeNull()
  })

  it('ignores a negative elapsed time (clock skew) instead of aging backwards', () => {
    const aged = ageResourceSnapshot(1, 6 * H, -120)
    expect(aged.nextRegenSeconds).toBe(6 * H)
  })
})

describe('seasonMaxForWindow', () => {
  it('caps the live 13-day season at 28, not 29 (end-of-season lockout)', () => {
    // The 15-minute lockout stops the boundary regen being credited on top of the opening bank.
    const start = 0
    const end = 13 * DAY * 1000
    expect(seasonMaxForWindow(start, end)).toBe(28)
  })

  it('derives the structural cap: opening bank + one regen per lockout-shortened interval', () => {
    const start = 0
    const end = 12.5 * DAY * 1000
    expect(seasonMaxForWindow(start, end)).toBe(27)
  })

  it('does not count a partial trailing interval as a token', () => {
    expect(seasonMaxForWindow(0, (2 * 12 * H + 11 * H) * 1000)).toBe(5)
  })

  it('falls back to the game constant on a degenerate window', () => {
    expect(seasonMaxForWindow(500, 500)).toBe(28)
    expect(seasonMaxForWindow(1000, 0)).toBe(28)
    expect(seasonMaxForWindow(Number.NaN, 5)).toBe(28)
  })

  it('derives the bomb cap from the same window: 1 + floor(311.75h / 18h) = 18', () => {
    expect(seasonMaxForWindow(0, 13 * DAY * 1000, BOMB_RESOURCE)).toBe(18)
    expect(seasonMaxForWindow(500, 500, BOMB_RESOURCE)).toBe(18)
  })
})

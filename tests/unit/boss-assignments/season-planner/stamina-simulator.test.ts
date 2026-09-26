import { describe, expect, it } from 'vitest'
import {
  advanceStamina,
  normaliseStaminaState,
  spendStamina
} from '@/app/lib/boss-assignments/season-planner/stamina-simulator'

const HOUR_MS = 60 * 60 * 1000

describe('stamina-simulator', () => {
  const settings = {
    max: 3,
    regenerationSeconds: 12 * 60 * 60,
    amountPerTick: 1
  }

  it('regenerates until cap and counts capped-time waste', () => {
    const start = 0
    const result = advanceStamina({
      state: {
        available: 1,
        nextRegenAt: start + 6 * HOUR_MS
      },
      settings,
      from: start,
      to: start + 30 * HOUR_MS
    })

    expect(result.state.available).toBe(3)
    expect(result.state.nextRegenAt).toBeNull()
    expect(result.metrics.regenTicks).toBe(2)
    expect(result.metrics.cappedSeconds).toBe(12 * 60 * 60)
    expect(result.metrics.wastedTicks).toBe(1)
    expect(result.metrics.wastedTokens).toBe(1)
  })

  it('restarts countdown when spending from cap', () => {
    const start = 0

    const spent = spendStamina({
      state: { available: 3, nextRegenAt: null },
      settings,
      amount: 1,
      at: start
    })

    expect(spent.spent).toBe(1)
    expect(spent.state.available).toBe(2)
    expect(spent.state.nextRegenAt).toBe(start + 12 * HOUR_MS)

    const after = advanceStamina({
      state: spent.state,
      settings,
      from: start,
      to: start + 12 * HOUR_MS
    })

    expect(after.state.available).toBe(3)
    expect(after.state.nextRegenAt).toBeNull()
    expect(after.metrics.regenTicks).toBe(1)
    expect(after.metrics.wastedTicks).toBe(0)
  })

  it('does not reset countdown when spending below cap', () => {
    const start = 0

    const spent = spendStamina({
      state: { available: 2, nextRegenAt: start + 1 * HOUR_MS },
      settings,
      amount: 1,
      at: start
    })

    expect(spent.state.available).toBe(1)
    expect(spent.state.nextRegenAt).toBe(start + 1 * HOUR_MS)
  })

  it('normalises missing nextRegenAt conservatively when below cap', () => {
    const start = 0

    const normalised = normaliseStaminaState(
      { available: 1, nextRegenAt: null },
      settings,
      start
    )

    expect(normalised.available).toBe(1)
    expect(normalised.nextRegenAt).toBe(start + 12 * HOUR_MS)
  })
})

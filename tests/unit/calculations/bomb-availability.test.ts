import { describe, it, expect } from 'vitest'
import {
  MAX_BOMBS,
  BOMB_COOLDOWN_SECONDS,
  computeBombAvailability
} from '@/app/lib/calculations/bomb-availability'

describe('bomb-availability', () => {
  it('exposes the bomb economy constants (18h, 1 bomb)', () => {
    expect(MAX_BOMBS).toBe(1)
    expect(BOMB_COOLDOWN_SECONDS).toBe(18 * 60 * 60)
  })

  it('is available when no bomb has been used', () => {
    const now = 1_000_000
    expect(computeBombAvailability(undefined, now)).toEqual({
      available: true,
      remainingSeconds: 0
    })
    expect(computeBombAvailability(null, now)).toEqual({
      available: true,
      remainingSeconds: 0
    })
  })

  it('gates for 18h after the last bomb, then frees', () => {
    const last = 1_000_000
    const sixHours = computeBombAvailability(last, last + 6 * 60 * 60)
    expect(sixHours.available).toBe(false)
    expect(sixHours.remainingSeconds).toBe(12 * 60 * 60)
    expect(computeBombAvailability(last, last + 18 * 60 * 60)).toEqual({
      available: true,
      remainingSeconds: 0
    })
  })
})

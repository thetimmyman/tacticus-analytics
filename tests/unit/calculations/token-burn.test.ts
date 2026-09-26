import { describe, it, expect } from 'vitest'
import {
  TOKEN_AVAILABLE_CAP,
  TOKEN_REGEN_SECONDS,
  MAX_POSSIBLE_HARD_CAP,
  cappedAvailable,
  tokenRegenProgress,
  computeGuildMaxPossibleTokens,
  calculateBurnedTokens
} from '@/app/lib/calculations/token-burn'

describe('token-burn canonical helper', () => {
  it('exposes the token economy constants', () => {
    expect(TOKEN_AVAILABLE_CAP).toBe(3)
    expect(TOKEN_REGEN_SECONDS).toBe(12 * 60 * 60)
    expect(MAX_POSSIBLE_HARD_CAP).toBe(28)
  })

  it('caps available into [0, 3]', () => {
    expect(cappedAvailable(undefined)).toBe(0)
    expect(cappedAvailable(null)).toBe(0)
    expect(cappedAvailable(Number.NaN)).toBe(0)
    expect(cappedAvailable(-2)).toBe(0)
    expect(cappedAvailable(2)).toBe(2)
    expect(cappedAvailable(9)).toBe(3)
  })

  describe('tokenRegenProgress', () => {
    it('is 0 for capped players (regen paused at 3/3)', () => {
      expect(tokenRegenProgress(3, 6 * 60 * 60)).toBe(0)
      expect(tokenRegenProgress(5, 6 * 60 * 60)).toBe(0)
    })

    it('is 0 when the cooldown is unknown or non-positive', () => {
      expect(tokenRegenProgress(1, null)).toBe(0)
      expect(tokenRegenProgress(1, undefined)).toBe(0)
      expect(tokenRegenProgress(1, 0)).toBe(0)
      expect(tokenRegenProgress(1, -100)).toBe(0)
      expect(tokenRegenProgress(1, Number.NaN)).toBe(0)
    })

    it('reflects the elapsed fraction of the 12h cycle for non-capped players', () => {
      expect(tokenRegenProgress(1, 6 * 60 * 60)).toBeCloseTo(0.5, 5)
      expect(tokenRegenProgress(0, 12 * 60 * 60)).toBeCloseTo(0, 5)
      expect(tokenRegenProgress(1, 100 * 60 * 60)).toBeCloseTo(0, 5)
    })
  })

  describe('computeGuildMaxPossibleTokens', () => {
    it('anchors on the highest used + capped-available, hard-capped at 28', () => {
      expect(computeGuildMaxPossibleTokens([])).toBe(0)
      expect(
        computeGuildMaxPossibleTokens([
          { totalTokens: 11, tokensAvailable: 1 },
          { totalTokens: 10, tokensAvailable: 0 }
        ])
      ).toBe(12)
      expect(
        computeGuildMaxPossibleTokens([{ totalTokens: 10, tokensAvailable: 9 }])
      ).toBe(13)
      expect(
        computeGuildMaxPossibleTokens([{ totalTokens: 50, tokensAvailable: 3 }])
      ).toBe(28)
      expect(
        computeGuildMaxPossibleTokens([
          { totalTokens: Number.NaN, tokensAvailable: 3 },
          { totalTokens: 9, tokensAvailable: Number.NaN }
        ])
      ).toBe(9)
    })
  })

  describe('calculateBurnedTokens', () => {
    it('returns null when availability is unknown or there is no anchor', () => {
      expect(calculateBurnedTokens(12, undefined, 5)).toBeNull()
      expect(calculateBurnedTokens(12, null, 5)).toBeNull()
      expect(calculateBurnedTokens(12, Number.NaN, 5)).toBeNull()
      expect(calculateBurnedTokens(Number.NaN, 2, 5)).toBeNull()
      expect(calculateBurnedTokens(12, 2, Number.NaN)).toBeNull()
      expect(calculateBurnedTokens(0, 2, 1)).toBeNull()
    })

    it('without regen credit, behaves like a discrete subtraction (legacy parity)', () => {
      expect(calculateBurnedTokens(12, 1, 11)).toBe(0)
      expect(calculateBurnedTokens(12, 1, 10)).toBe(1)
      expect(calculateBurnedTokens(12, 3, 6)).toBe(3)
    })

    it('floors a mid-cycle, one-token-behind player to 0 burned (the /token-overview parity fix)', () => {
      const SIX_HOURS = 6 * 60 * 60
      expect(calculateBurnedTokens(12, 1, 10, SIX_HOURS)).toBe(0)
      expect(calculateBurnedTokens(12, 3, 6, SIX_HOURS)).toBe(3)
      expect(calculateBurnedTokens(12, 0, 9, SIX_HOURS)).toBe(2)
    })
  })
})

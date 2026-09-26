import { describe, it, expect } from 'vitest'
import { loopIndexFromTier } from '@/app/lib/calculations/loop-from-tier'

describe('loopIndexFromTier (WI-2212)', () => {
  it('maps sub-4 tiers (and non-finite) to loop 0, tolerantly', () => {
    expect(loopIndexFromTier(0)).toBe(0)
    expect(loopIndexFromTier(3)).toBe(0)
    expect(loopIndexFromTier(-5)).toBe(0)
    expect(loopIndexFromTier(Number.NaN)).toBe(0)
  })

  it('maps Legendary/Mythic and beyond to incrementing loops', () => {
    expect(loopIndexFromTier(4)).toBe(0) // Legendary, loop 0
    expect(loopIndexFromTier(5)).toBe(0) // Mythic, loop 0
    expect(loopIndexFromTier(6)).toBe(1)
    expect(loopIndexFromTier(7)).toBe(1)
    expect(loopIndexFromTier(8)).toBe(2)
    expect(loopIndexFromTier(45)).toBe(20)
  })
})

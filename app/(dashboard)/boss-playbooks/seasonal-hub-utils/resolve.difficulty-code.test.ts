import { describe, it, expect } from 'vitest'
import { difficultyCodeFromOneBasedSet } from '@/app/lib/boss-ops/identity'
import { difficultyCodeFor } from './resolve'

// The hub's `set` is 0-based, unlike boss_target_tokens; pin the +1 shift.

const ZERO_BASED_SETS = [0, 1, 2, 3, 4]

describe('difficultyCodeFor', () => {
  it('shifts the hub 0-based set onto the canonical 1-based codes', () => {
    expect(
      ZERO_BASED_SETS.map((set) => difficultyCodeFor('Legendary', set))
    ).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
    expect(
      ZERO_BASED_SETS.map((set) => difficultyCodeFor('Mythic', set))
    ).toEqual(['M1', 'M2', 'M3', 'M4', 'M5'])
  })

  it('equals the canonical helper applied to set + 1', () => {
    for (const rarity of ['Legendary', 'Mythic'] as const) {
      for (const set of ZERO_BASED_SETS) {
        expect(difficultyCodeFor(rarity, set)).toBe(
          difficultyCodeFromOneBasedSet(rarity, set + 1)
        )
      }
    }
  })
})

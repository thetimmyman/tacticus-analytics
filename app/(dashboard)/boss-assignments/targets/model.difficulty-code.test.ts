import { describe, it, expect } from 'vitest'
import { difficultyCodeFromOneBasedSet } from '@/app/lib/boss-ops/identity'
import { levelLabel } from './model'

// Pins the whole rarity+set -> difficulty-code matrix of the canonical helper.

const SETS = [1, 2, 3, 4, 5]

describe('difficultyCodeFromOneBasedSet', () => {
  it('maps the full Legendary/Mythic matrix from a 1-based set', () => {
    expect(
      SETS.map((set) => difficultyCodeFromOneBasedSet('Legendary', set))
    ).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
    expect(
      SETS.map((set) => difficultyCodeFromOneBasedSet('Mythic', set))
    ).toEqual(['M1', 'M2', 'M3', 'M4', 'M5'])
  })

  it('passes an out-of-range set straight through without clamping', () => {
    expect(difficultyCodeFromOneBasedSet('Legendary', 0)).toBe('L0')
    expect(difficultyCodeFromOneBasedSet('Mythic', 6)).toBe('M6')
    expect(difficultyCodeFromOneBasedSet('Legendary', -1)).toBe('L-1')
  })
})

describe('levelLabel', () => {
  it('delegates to the canonical helper with no set shift', () => {
    for (const rarity of ['Legendary', 'Mythic'] as const) {
      for (const set of SETS) {
        expect(levelLabel(rarity, set)).toBe(
          difficultyCodeFromOneBasedSet(rarity, set)
        )
      }
    }
  })

  it('renders the 1-based MergedRow set as the stored stage code', () => {
    expect(levelLabel('Legendary', 1)).toBe('L1')
    expect(levelLabel('Legendary', 5)).toBe('L5')
    expect(levelLabel('Mythic', 1)).toBe('M1')
    expect(levelLabel('Mythic', 5)).toBe('M5')
  })
})

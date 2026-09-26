import { describe, it, expect } from 'vitest'
import {
  ladderOrdinal,
  levelCodeFrom,
  filterToLoopWindow,
  isBelowLoopWindow,
  resolveLoopRestartOrdinal,
  toLoopObservations
} from '@/app/lib/boss-assignments/loop-window'

const obs = (guild: string, levels: Record<string, number>) =>
  Object.entries(levels).map(([level, maxLoopIndex]) => ({
    guild,
    level,
    maxLoopIndex
  }))

const visible = (
  levels: string[],
  observations: Parameters<typeof filterToLoopWindow>[2]
) => filterToLoopWindow(levels, (l) => l as string, observations)

const LADDER = ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2', 'M3']

describe('ladderOrdinal', () => {
  it('orders the ladder C1 < E5 < L1 < L5 < M1 < M3', () => {
    const codes = ['M3', 'M1', 'L5', 'L1', 'E5', 'C1']
    const sorted = [...codes].sort(
      (a, b) => ladderOrdinal(a)! - ladderOrdinal(b)!
    )
    expect(sorted).toEqual(['C1', 'E5', 'L1', 'L5', 'M1', 'M3'])
  })

  it('returns null for non-level labels so they are never hidden', () => {
    expect(ladderOrdinal('')).toBeNull()
    expect(ladderOrdinal('Prime')).toBeNull()
    expect(ladderOrdinal('X1')).toBeNull()
    expect(ladderOrdinal('L0')).toBeNull()
    expect(ladderOrdinal('L')).toBeNull()
  })
})

describe('levelCodeFrom', () => {
  it('maps the raw EOT_GR_data rarity + 0-indexed set to a level code', () => {
    expect(levelCodeFrom('Legendary', 3)).toBe('L4')
    expect(levelCodeFrom('Mythic', 0)).toBe('M1')
    expect(levelCodeFrom('mythic', 2)).toBe('M3')
  })

  it('rejects unusable input', () => {
    expect(levelCodeFrom(null, 3)).toBeNull()
    expect(levelCodeFrom('Legendary', null)).toBeNull()
    expect(levelCodeFrom('Legendary', -1)).toBeNull()
  })
})

describe('resolveLoopRestartOrdinal — the (4,3) L4->M3 loop', () => {
  it('hides nothing while the guild is still on its first pass', () => {
    const observations = obs('A', {
      L1: 0,
      L2: 0,
      L3: 0,
      L4: 0,
      L5: 0,
      M1: 0,
      M2: 0,
      M3: 0
    })
    expect(resolveLoopRestartOrdinal(observations)).toBeNull()
    expect(visible(LADDER, observations)).toEqual(LADDER)
  })

  it('hides L1-L3 once the loop has actually restarted at L4', () => {
    const observations = obs('A', {
      L1: 0,
      L2: 0,
      L3: 0,
      L4: 1,
      L5: 1,
      M1: 1,
      M2: 1,
      M3: 1
    })
    expect(visible(LADDER, observations)).toEqual([
      'L4',
      'L5',
      'M1',
      'M2',
      'M3'
    ])
  })

  it('keeps M1-M3 mid-loop-2, when only L4 has looped yet', () => {
    // Wrapped to L4 but not yet back at Mythic: "never looped → hide" breaks here.
    const observations = obs('A', {
      L1: 0,
      L2: 0,
      L3: 0,
      L4: 1,
      L5: 0,
      M1: 0,
      M2: 0,
      M3: 0
    })
    expect(visible(LADDER, observations)).toEqual([
      'L4',
      'L5',
      'M1',
      'M2',
      'M3'
    ])
  })

  it('matches production season 107 aggregate loop indexes', () => {
    const observations = obs('A', {
      L1: 0,
      L2: 0,
      L3: 0,
      L4: 2,
      L5: 2,
      M1: 1,
      M2: 1,
      M3: 1
    })
    expect(visible(LADDER, observations)).toEqual([
      'L4',
      'L5',
      'M1',
      'M2',
      'M3'
    ])
  })

  it('hides the sub-Legendary rarities too once the loop restarts at L4', () => {
    const levels = ['C1', 'R2', 'E5', 'L3', 'L4', 'M1']
    const observations = obs('A', { L3: 0, L4: 1, M1: 1 })
    expect(visible(levels, observations)).toEqual(['L4', 'M1'])
  })
})

describe('resolveLoopRestartOrdinal — the (4,0) full-ladder seasons', () => {
  it('hides nothing when the whole Legendary ladder keeps looping', () => {
    // S110 reverts to loopFromSet 0, so L1 itself reaches loopIndex >= 1.
    const observations = obs('A', {
      L1: 1,
      L2: 1,
      L3: 1,
      L4: 1,
      L5: 1,
      M1: 1,
      M2: 0
    })
    expect(visible(LADDER, observations)).toEqual(LADDER)
  })
})

describe('resolveLoopRestartOrdinal — cluster scope spans many guilds', () => {
  it('keeps the full ladder when any guild is still on its first pass', () => {
    const observations = [
      ...obs('looped', { L1: 0, L2: 0, L3: 0, L4: 2, L5: 2, M1: 1 }),
      ...obs('first-pass', { L1: 0, L2: 0, L3: 0, L4: 0 })
    ]
    expect(resolveLoopRestartOrdinal(observations)).toBeNull()
    expect(visible(LADDER, observations)).toEqual(LADDER)
  })

  it('trims only when every guild in scope has looped', () => {
    const observations = [
      ...obs('a', { L1: 0, L2: 0, L3: 0, L4: 2, M1: 1 }),
      ...obs('b', { L1: 0, L2: 0, L3: 0, L4: 1, M1: 1 })
    ]
    expect(visible(LADDER, observations)).toEqual([
      'L4',
      'L5',
      'M1',
      'M2',
      'M3'
    ])
  })

  it('floors on the least-advanced guild', () => {
    const observations = [
      ...obs('from-l4', { L4: 1, L5: 1, M1: 1 }),
      ...obs('from-m1', { L4: 0, L5: 0, M1: 1, M2: 1 })
    ]
    expect(visible(LADDER, observations)).toEqual([
      'L4',
      'L5',
      'M1',
      'M2',
      'M3'
    ])
  })
})

describe('resolveLoopRestartOrdinal — degenerate input', () => {
  it('hides nothing for an empty observation set', () => {
    expect(resolveLoopRestartOrdinal([])).toBeNull()
    expect(visible(LADDER, [])).toEqual(LADDER)
  })

  it('ignores unparseable levels when locating the restart point', () => {
    const observations = [
      { guild: 'A', level: 'Prime', maxLoopIndex: 5 },
      ...obs('A', { L1: 0, L4: 1 })
    ]
    expect(visible(LADDER, observations)).toEqual([
      'L4',
      'L5',
      'M1',
      'M2',
      'M3'
    ])
  })
})

describe('isBelowLoopWindow', () => {
  const floor = ladderOrdinal('L4')!

  it('is true only for levels ordered below the restart point', () => {
    expect(isBelowLoopWindow('L3', floor)).toBe(true)
    expect(isBelowLoopWindow('E5', floor)).toBe(true)
    expect(isBelowLoopWindow('L4', floor)).toBe(false)
    expect(isBelowLoopWindow('M1', floor)).toBe(false)
  })

  it('hides nothing when there is no restart point', () => {
    expect(isBelowLoopWindow('L1', null)).toBe(false)
  })

  it('never hides an unrecognised label', () => {
    expect(isBelowLoopWindow('Prime', floor)).toBe(false)
  })
})

describe('toLoopObservations', () => {
  it('reduces battle rows to one max-loopIndex per guild and level', () => {
    const rows = [
      { rarity: 'Legendary', set: 3, loopIndex: 0, Guild: 'A' },
      { rarity: 'Legendary', set: 3, loopIndex: 2, Guild: 'A' },
      { rarity: 'Legendary', set: 3, loopIndex: 1, Guild: 'B' },
      { rarity: 'Mythic', set: 2, loopIndex: 1, Guild: 'A' }
    ]
    expect(toLoopObservations(rows)).toEqual([
      { level: 'L4', maxLoopIndex: 2, guild: 'A' },
      { level: 'L4', maxLoopIndex: 1, guild: 'B' },
      { level: 'M3', maxLoopIndex: 1, guild: 'A' }
    ])
  })

  it('treats a null loopIndex as loop 0 rather than dropping the row', () => {
    expect(
      toLoopObservations([
        { rarity: 'Legendary', set: 0, loopIndex: null, Guild: 'A' }
      ])
    ).toEqual([{ level: 'L1', maxLoopIndex: 0, guild: 'A' }])
  })

  it('skips rows with no usable rarity or set', () => {
    expect(
      toLoopObservations([
        { rarity: null, set: 3, loopIndex: 1, Guild: 'A' },
        { rarity: 'Legendary', set: null, loopIndex: 1, Guild: 'A' }
      ])
    ).toEqual([])
  })
})

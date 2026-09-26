import { describe, it, expect } from 'vitest'
import {
  buildClusterBossMatrices,
  type ClusterBossMatrixRow
} from '@/app/lib/data/cluster-boss-matrix'

function row(p: Partial<ClusterBossMatrixRow>): ClusterBossMatrixRow {
  return {
    guild_code: 'GA',
    boss_name: 'Screamer_Killer',
    rarity: 'Legendary',
    set: 0,
    encounter_id: 0,
    loop_index: 0,
    tokens: 0,
    total_damage: 0,
    finisher_tokens: 0,
    finisher_damage: 0,
    killed: false,
    ...p
  }
}

const LOOP0: ClusterBossMatrixRow[] = [
  row({
    guild_code: 'GA',
    boss_name: 'TervigonPrime',
    encounter_id: 1,
    tokens: 4,
    total_damage: 200,
    finisher_tokens: 1,
    finisher_damage: 10,
    killed: true
  }),
  row({
    guild_code: 'GA',
    boss_name: 'Screamer_Killer',
    encounter_id: 0,
    tokens: 10,
    total_damage: 1000,
    finisher_tokens: 1,
    finisher_damage: 50,
    killed: true
  }),
  row({
    guild_code: 'GA',
    boss_name: 'Magnus',
    rarity: 'Mythic',
    encounter_id: 0,
    tokens: 15,
    total_damage: 3000,
    finisher_tokens: 0,
    finisher_damage: 0,
    killed: false // still being fought → live
  }),
  row({
    guild_code: 'GB',
    boss_name: 'Screamer_Killer',
    encounter_id: 0,
    tokens: 8,
    total_damage: 900,
    finisher_tokens: 1,
    finisher_damage: 100,
    killed: true
  })
]

const LOOP1: ClusterBossMatrixRow[] = [
  row({
    guild_code: 'GA',
    loop_index: 1,
    encounter_id: 0,
    tokens: 5,
    total_damage: 600,
    finisher_tokens: 1,
    finisher_damage: 20,
    killed: true
  }),
  row({
    guild_code: 'GB',
    boss_name: 'Magnus',
    rarity: 'Mythic',
    loop_index: 1,
    encounter_id: 0,
    tokens: 0,
    total_damage: 0,
    finisher_tokens: 0,
    finisher_damage: 0,
    killed: true // bomb-kill: killed despite 0 battle tokens
  })
]

const ALL = [...LOOP0, ...LOOP1]

describe('buildClusterBossMatrices', () => {
  it('returns fully empty structure for no rows', () => {
    const m = buildClusterBossMatrices([], {
      loopIndex: null,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(m).toEqual({
      loops: [],
      selectedLoop: null,
      columns: [],
      guilds: [],
      damage: {},
      tokens: {}
    })
  })

  it('enumerates loops and defaults to the max loop', () => {
    const m = buildClusterBossMatrices(ALL, {
      loopIndex: null,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(m.loops).toEqual([0, 1])
    expect(m.selectedLoop).toBe(1)
  })

  it('honors an explicit loop selection', () => {
    const m = buildClusterBossMatrices(ALL, {
      loopIndex: 0,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(m.selectedLoop).toBe(0)
    expect(m.guilds).toEqual(['GA', 'GB'])
  })

  it('orders columns Legendary-first then Mythic and labels from the main boss', () => {
    const m = buildClusterBossMatrices(LOOP0, {
      loopIndex: 0,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(m.columns.map((c) => c.key)).toEqual(['L1', 'M1'])
    expect(m.columns[0]!.label).toBe('L1 · Screamer Killer')
    expect(m.columns[1]!.label).toBe('M1 · Magnus the Red')
  })

  it('computes damage-per-token excluding finishers by default', () => {
    const m = buildClusterBossMatrices(LOOP0, {
      loopIndex: 0,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(m.damage.GA!.L1!.value).toBeCloseTo(950 / 9, 6)
  })

  it('includes finishers when toggled on', () => {
    const m = buildClusterBossMatrices(LOOP0, {
      loopIndex: 0,
      includeFinishers: true,
      includeSideBosses: true
    })
    expect(m.damage.GA!.L1!.value).toBeCloseTo(1000 / 10, 6)
  })

  it('sums side bosses into tokens-to-kill only when toggled on', () => {
    const withSide = buildClusterBossMatrices(LOOP0, {
      loopIndex: 0,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(withSide.tokens.GA!.L1!.value).toBe(14)

    const mainOnly = buildClusterBossMatrices(LOOP0, {
      loopIndex: 0,
      includeFinishers: false,
      includeSideBosses: false
    })
    expect(mainOnly.tokens.GA!.L1!.value).toBe(10)
  })

  it('marks an unkilled main boss as live', () => {
    const m = buildClusterBossMatrices(LOOP0, {
      loopIndex: 0,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(m.tokens.GA!.M1!.live).toBe(true)
    expect(m.tokens.GA!.M1!.value).toBe(15)
    expect(m.tokens.GA!.L1!.live).toBe(false)
  })

  it('renders missing cells as null (—)', () => {
    const m = buildClusterBossMatrices(LOOP0, {
      loopIndex: 0,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(m.tokens.GB!.M1!.value).toBeNull()
    expect(m.damage.GB!.M1!.value).toBeNull()
  })

  it('treats a bomb-kill (0 battle tokens) as killed, not live, with null damage', () => {
    const m = buildClusterBossMatrices(LOOP1, {
      loopIndex: 1,
      includeFinishers: false,
      includeSideBosses: true
    })
    expect(m.tokens.GB!.M1!.value).toBe(0)
    expect(m.tokens.GB!.M1!.live).toBe(false)
    expect(m.damage.GB!.M1!.value).toBeNull()
  })
})

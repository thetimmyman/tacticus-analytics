import { describe, expect, it } from 'vitest'
import {
  buildSeasonCanonicalMap,
  canonicalizeBossId,
  filterBosses,
  sortBossesByName
} from '@/app/(dashboard)/boss-playbooks/utils/playbook-helpers'
import type {
  Boss,
  SeasonConfigInfo
} from '@/app/(dashboard)/boss-playbooks/types'

const makeBoss = (overrides: Partial<Boss>): Boss => ({
  id: 'boss-a',
  name: 'Boss A',
  faction: 'Faction',
  bannedFaction: 'None',
  turnLimit: 5,
  movement: 2,
  encounterMix: { boss: 1, crystal: 0 },
  boards: [],
  playbook: 'default',
  threats: [],
  keyThresholds: [],
  cooldowns: [],
  coreMechanic: 'core',
  ...overrides
})

describe('canonicalizeBossId', () => {
  it('normalizes special-case boss ids', () => {
    expect(canonicalizeBossId('Tervigon-Prime')).toBe('tervigon')
    expect(canonicalizeBossId('Hive Tyrant')).toBe('hive_tyrant')
  })

  it('strips non-alphanumeric characters and lowercases', () => {
    expect(canonicalizeBossId('Boss-01')).toBe('boss01')
  })
})

describe('buildSeasonCanonicalMap', () => {
  it('indexes season canonicals by id', () => {
    const seasons: SeasonConfigInfo[] = [
      { id: 'season-1', index: 1, canonicals: ['hive_tyrant'] },
      { id: 'season-2', index: 2, canonicals: ['tervigon'] }
    ]

    const map = buildSeasonCanonicalMap(seasons)

    expect(map.get('season-1')?.has('hive_tyrant')).toBe(true)
    expect(map.get('season-2')?.has('tervigon')).toBe(true)
  })
})

describe('filterBosses', () => {
  const bosses = [
    makeBoss({
      id: 'Hive Tyrant',
      name: 'Hive Tyrant',
      faction: 'Tyranids',
      strain: 'Alpha'
    }),
    makeBoss({
      id: 'Tervigon-Prime',
      name: 'Tervigon Prime',
      faction: 'Tyranids',
      strain: 'Beta'
    }),
    makeBoss({
      id: 'RogalDorn',
      name: 'Rogal Dorn',
      faction: 'Imperium',
      strain: 'Gamma'
    })
  ]

  const seasons: SeasonConfigInfo[] = [
    { id: 'season-1', index: 1, canonicals: ['hive_tyrant', 'tervigon'] }
  ]

  const seasonCanonicalMap = buildSeasonCanonicalMap(seasons)

  it('filters bosses by season canonicals', () => {
    const filtered = filterBosses({
      bosses,
      seasonCanonicalMap,
      selectedSeason: 'season-1',
      searchQuery: ''
    })

    expect(filtered.map((boss) => boss.name)).toEqual([
      'Hive Tyrant',
      'Tervigon Prime'
    ])
  })

  it('matches bosses by search query across fields', () => {
    const factionMatch = filterBosses({
      bosses,
      seasonCanonicalMap,
      selectedSeason: 'all',
      searchQuery: 'imper'
    })

    expect(factionMatch.map((boss) => boss.name)).toEqual(['Rogal Dorn'])

    const strainMatch = filterBosses({
      bosses,
      seasonCanonicalMap,
      selectedSeason: 'all',
      searchQuery: 'beta'
    })

    expect(strainMatch.map((boss) => boss.name)).toEqual(['Tervigon Prime'])
  })
})

describe('sortBossesByName', () => {
  it('sorts bosses by name', () => {
    const sorted = sortBossesByName([
      makeBoss({ name: 'Zeta' }),
      makeBoss({ name: 'Alpha' })
    ])

    expect(sorted.map((boss) => boss.name)).toEqual(['Alpha', 'Zeta'])
  })
})

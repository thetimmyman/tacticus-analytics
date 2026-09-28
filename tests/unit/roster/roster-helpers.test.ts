import { describe, expect, it } from 'vitest'
import {
  getRankBgColor,
  getRankColor,
  getRankName,
  getRarityBorderColor,
  getRarityColor,
  getRarityFromProgressionIndex,
  isMythicWinged,
  mergeRosterUnits,
  resolveHeroIconUrl,
  type HeroMapping,
  type RosterUnit,
  type RosterUnitEntry,
  type UnitRarity
} from '@/app/(dashboard)/roster/utils/roster-helpers'

const makeUnit = (overrides: Partial<RosterUnit> = {}): RosterUnit => ({
  id: 'unit-1',
  name: 'Unit One',
  faction: 'Ultramarines',
  grandAlliance: 'Imperial',
  progressionIndex: 0,
  xp: 0,
  xpLevel: 1,
  rank: 0,
  shards: 0,
  abilities: [{ id: 'ability-1', level: 1 }],
  ...overrides
})

const makeUnitEntry = (
  overrides: Partial<RosterUnitEntry> = {}
): RosterUnitEntry => ({
  ...makeUnit(),
  ...overrides
})

const makeHeroMapping = (
  overrides: Partial<HeroMapping> = {}
): HeroMapping => ({
  unit_id: 'unit-1',
  display_name: 'Hero Name',
  web_icon_url: 'https://cdn.example/hero.png',
  ...overrides
})

describe('getRankName', () => {
  it('returns mapped rank names and falls back to Rank {n}', () => {
    expect(getRankName(0)).toBe('Stone I')
    expect(getRankName(14)).toBe('Gold III')
    expect(getRankName(20)).toBe('Adamantium III')
    expect(getRankName(21)).toBe('Mythic I')
    expect(getRankName(23)).toBe('Mythic III')
    expect(getRankName(99)).toBe('Rank 99')
  })
})

describe('getRankColor', () => {
  it('maps rank thresholds to text colors', () => {
    expect(getRankColor(21)).toBe('text-orange-500')
    expect(getRankColor(18)).toBe('text-orange-500')
    expect(getRankColor(15)).toBe('text-cyan-300')
    expect(getRankColor(12)).toBe('text-yellow-400')
    expect(getRankColor(9)).toBe('text-gray-300')
    expect(getRankColor(6)).toBe('text-orange-400')
    expect(getRankColor(3)).toBe('text-gray-400')
    expect(getRankColor(0)).toBe('text-stone-500')
  })
})

describe('getRankBgColor', () => {
  it('maps rank thresholds to background colors', () => {
    expect(getRankBgColor(21)).toBe(
      'bg-linear-to-r from-orange-600/30 to-red-500/30 border-orange-500/50'
    )
    expect(getRankBgColor(18)).toBe(
      'bg-linear-to-r from-orange-600/30 to-red-500/30 border-orange-500/50'
    )
    expect(getRankBgColor(15)).toBe(
      'bg-linear-to-r from-cyan-600/30 to-blue-500/30 border-cyan-500/50'
    )
    expect(getRankBgColor(12)).toBe('bg-yellow-500/20 border-yellow-500/50')
    expect(getRankBgColor(9)).toBe('bg-gray-400/20 border-gray-400/50')
    expect(getRankBgColor(6)).toBe('bg-orange-500/20 border-orange-500/50')
    expect(getRankBgColor(3)).toBe('bg-gray-500/20 border-gray-500/50')
    expect(getRankBgColor(0)).toBe('bg-stone-600/20 border-stone-500/50')
  })
})

describe('getRarityFromProgressionIndex', () => {
  it('maps progression tiers to rarities', () => {
    expect(getRarityFromProgressionIndex(0)).toBe('Common')
    expect(getRarityFromProgressionIndex(3)).toBe('Uncommon')
    expect(getRarityFromProgressionIndex(6)).toBe('Rare')
    expect(getRarityFromProgressionIndex(9)).toBe('Epic')
    expect(getRarityFromProgressionIndex(12)).toBe('Legendary')
    expect(getRarityFromProgressionIndex(16)).toBe('Mythic')
  })
})

describe('getRarityColor', () => {
  it('maps rarities to text colors', () => {
    const cases: Array<[UnitRarity, string]> = [
      ['Mythic', 'text-red-400'],
      ['Legendary', 'text-cyan-300'],
      ['Epic', 'text-yellow-400'],
      ['Rare', 'text-blue-400'],
      ['Uncommon', 'text-green-400'],
      ['Common', 'text-gray-400']
    ]

    cases.forEach(([rarity, expected]) => {
      expect(getRarityColor(rarity)).toBe(expected)
    })
  })
})

describe('getRarityBorderColor', () => {
  it('maps rarities to border styles', () => {
    const cases: Array<[UnitRarity, string]> = [
      ['Mythic', 'border-red-500/60 shadow-red-500/20 shadow-xs'],
      ['Legendary', 'border-cyan-400/60 shadow-cyan-400/20 shadow-xs'],
      ['Epic', 'border-yellow-500/60 shadow-yellow-500/20 shadow-xs'],
      ['Rare', 'border-blue-500/60 shadow-blue-500/20 shadow-xs'],
      ['Uncommon', 'border-green-500/60'],
      ['Common', 'border-gray-500/40']
    ]

    cases.forEach(([rarity, expected]) => {
      expect(getRarityBorderColor(rarity)).toBe(expected)
    })
  })
})

describe('resolveHeroIconUrl', () => {
  it('returns the icon url when matched by unit id', () => {
    const mapping = makeHeroMapping({
      unit_id: 'unit-1',
      web_icon_url: 'https://cdn.example/unit.png'
    })
    const map = new Map<string, HeroMapping>([['unit-1', mapping]])

    expect(resolveHeroIconUrl(map, 'unit-1', 'Hero Name')).toBe(
      'https://cdn.example/unit.png'
    )
  })

  it('falls back to display name lookup when id is missing', () => {
    const mapping = makeHeroMapping({
      display_name: 'Shadow Guard',
      web_icon_url: 'https://cdn.example/shadow.png'
    })
    const map = new Map<string, HeroMapping>([['shadow guard', mapping]])

    expect(resolveHeroIconUrl(map, 'unit-x', 'Shadow Guard')).toBe(
      'https://cdn.example/shadow.png'
    )
  })

  it('returns null when no icon url is available', () => {
    const mapping = makeHeroMapping({ unit_id: 'unit-2', web_icon_url: null })
    const map = new Map<string, HeroMapping>([['unit-2', mapping]])

    expect(resolveHeroIconUrl(map, 'unit-2', 'Unknown')).toBe(null)
  })
})

describe('isMythicWinged', () => {
  it('returns false when progression index is below mythic', () => {
    const unit = makeUnit({
      progressionIndex: 15,
      abilities: [{ id: 'a', level: 60 }]
    })
    expect(isMythicWinged(unit)).toBe(false)
  })

  it('returns false when no abilities are present', () => {
    const unit = makeUnit({ progressionIndex: 16, abilities: [] })
    expect(isMythicWinged(unit)).toBe(false)
  })

  it('returns true only when all abilities are maxed', () => {
    const unit = makeUnit({
      progressionIndex: 16,
      abilities: [
        { id: 'a', level: 50 },
        { id: 'b', level: 52 }
      ]
    })
    expect(isMythicWinged(unit)).toBe(true)
  })

  it('returns false when any ability is below max', () => {
    const unit = makeUnit({
      progressionIndex: 16,
      abilities: [
        { id: 'a', level: 50 },
        { id: 'b', level: 49 }
      ]
    })
    expect(isMythicWinged(unit)).toBe(false)
  })
})

describe('mergeRosterUnits', () => {
  it('deduplicates units by engineId when present', () => {
    const units = [
      makeUnitEntry({ id: 'unit-1', engineId: 'engine-1' }),
      makeUnitEntry({ id: 'unit-2', engineId: 'engine-2' })
    ]
    const mows = [
      makeUnitEntry({ id: 'unit-3', engineId: 'engine-1' }),
      makeUnitEntry({ id: 'unit-4' })
    ]

    const merged = mergeRosterUnits(units, mows)

    expect(merged.map((unit) => unit.id)).toEqual([
      'unit-1',
      'unit-2',
      'unit-4'
    ])
  })

  it('falls back to id when engineId is missing or blank', () => {
    const units = [makeUnitEntry({ id: 'unit-1', engineId: '' })]
    const mows = [
      makeUnitEntry({ id: 'unit-1', engineId: null }),
      makeUnitEntry({ id: 'unit-2', engineId: '  ' })
    ]

    const merged = mergeRosterUnits(units, mows)

    expect(merged.map((unit) => unit.id)).toEqual(['unit-1', 'unit-2'])
  })
})

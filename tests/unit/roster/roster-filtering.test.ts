import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CRITERIA,
  filterAndSortUnits,
  matchesFaction,
  normalizeFactionKey
} from '@/app/(dashboard)/roster/_lib/roster-filtering'
import { FACTIONS } from '@/app/(dashboard)/roster/_lib/roster-constants'
import type { RosterUnit } from '@/app/(dashboard)/roster/utils/roster-helpers'

const unit = (over: Partial<RosterUnit> & { id: string }): RosterUnit => ({
  name: over.id,
  faction: 'Ultramarines',
  grandAlliance: 'Imperial',
  progressionIndex: 5,
  xp: 0,
  xpLevel: 30,
  rank: 10,
  shards: 0,
  abilities: [
    { id: 'a', level: 3 },
    { id: 'b', level: 5 }
  ],
  ...over
})

const NO_META = {
  heroMappings: new Map(),
  metaTeamHeroNames: new Set<string>()
}

describe('normalizeFactionKey', () => {
  it('collapses case, spaces, and punctuation', () => {
    expect(normalizeFactionKey("T'au Empire")).toBe('tauempire')
    expect(normalizeFactionKey('Astra Militarum')).toBe('astramilitarum')
    expect(normalizeFactionKey('AstraMilitarum')).toBe('astramilitarum')
    expect(normalizeFactionKey("Emperor's Children")).toBe('emperorschildren')
  })
})

describe('matchesFaction', () => {
  it('matches camelCase game-data ids against canonical ids', () => {
    expect(matchesFaction('AstraMilitarum', 'AstraMilitarum')).toBe(true)
    expect(matchesFaction('BloodAngels', 'BloodAngels')).toBe(true)
    expect(matchesFaction('AdeptusMechanicus', 'AdeptusMechanicus')).toBe(true)
  })

  it('matches spaced display names against canonical ids', () => {
    expect(matchesFaction('Astra Militarum', 'AstraMilitarum')).toBe(true)
    expect(matchesFaction('Death Guard', 'DeathGuard')).toBe(true)
    expect(matchesFaction("Emperor's Children", 'EmperorsChildren')).toBe(true)
  })

  it('handles renamed factions via label/alias', () => {
    expect(matchesFaction('Sisterhood', 'Sisterhood')).toBe(true)
    expect(matchesFaction('Adepta Sororitas', 'Sisterhood')).toBe(true)
    expect(matchesFaction('Tau', 'Tau')).toBe(true)
    expect(matchesFaction("T'au Empire", 'Tau')).toBe(true)
    expect(matchesFaction('Genestealers', 'Genestealers')).toBe(true)
    expect(matchesFaction('Genestealer Cults', 'Genestealers')).toBe(true)
  })

  it('rejects non-members and unknown selections', () => {
    expect(matchesFaction('Orks', 'AstraMilitarum')).toBe(false)
    expect(matchesFaction('Orks', 'NotAFaction')).toBe(false)
  })

  it('every canonical faction matches its own id and label', () => {
    for (const f of FACTIONS) {
      expect(matchesFaction(f.id, f.id)).toBe(true)
      expect(matchesFaction(f.label, f.id)).toBe(true)
    }
  })
})

describe('filterAndSortUnits', () => {
  const units = [
    unit({
      id: 'calgar',
      faction: 'Ultramarines',
      rank: 20,
      xpLevel: 60,
      progressionIndex: 19
    }),
    unit({
      id: 'gulgortz',
      name: 'Gulgortz',
      faction: 'Orks',
      grandAlliance: 'Xenos',
      rank: 14,
      xpLevel: 50
    }),
    unit({
      id: 'guardsman',
      faction: 'AstraMilitarum',
      rank: 3,
      xpLevel: 12,
      progressionIndex: 2,
      abilities: [{ id: 'a', level: 1 }]
    }),
    unit({ id: 'cawl', faction: 'Adeptus Mechanicus', rank: 9, xpLevel: 40 })
  ]

  it('faction filter matches both string formats through one dropdown id', () => {
    const spaced = filterAndSortUnits(
      units,
      { ...DEFAULT_CRITERIA, factionId: 'AdeptusMechanicus' },
      NO_META
    )
    expect(spaced.map((u) => u.id)).toEqual(['cawl'])

    const camel = filterAndSortUnits(
      units,
      { ...DEFAULT_CRITERIA, factionId: 'AstraMilitarum' },
      NO_META
    )
    expect(camel.map((u) => u.id)).toEqual(['guardsman'])
  })

  it('applies search, alliance, rarity, rank tier, and ability range', () => {
    expect(
      filterAndSortUnits(
        units,
        { ...DEFAULT_CRITERIA, searchTerm: 'gul' },
        NO_META
      )
    ).toHaveLength(1)
    expect(
      filterAndSortUnits(
        units,
        { ...DEFAULT_CRITERIA, alliance: 'Xenos' },
        NO_META
      )
    ).toHaveLength(1)
    expect(
      filterAndSortUnits(
        units,
        { ...DEFAULT_CRITERIA, rarity: 'Mythic' },
        NO_META
      ).map((u) => u.id)
    ).toEqual(['calgar'])
    expect(
      filterAndSortUnits(
        units,
        { ...DEFAULT_CRITERIA, rankTier: 'iron' },
        NO_META
      ).map((u) => u.id)
    ).toEqual(['guardsman'])
    expect(
      filterAndSortUnits(
        units,
        { ...DEFAULT_CRITERIA, abilityMin: '4' },
        NO_META
      ).map((u) => u.id)
    ).toEqual(['calgar', 'gulgortz', 'cawl'])
  })

  it('sorts by rank desc by default and name asc when asked', () => {
    const byRank = filterAndSortUnits(units, DEFAULT_CRITERIA, NO_META)
    expect(byRank.map((u) => u.rank)).toEqual([20, 14, 9, 3])

    const byName = filterAndSortUnits(
      units,
      { ...DEFAULT_CRITERIA, sortField: 'name', sortDirection: 'asc' },
      NO_META
    )
    expect(byName[0].name < byName[1].name).toBe(true)
  })

  it('meta-team hero names filter by fuzzy name containment', () => {
    const result = filterAndSortUnits(units, DEFAULT_CRITERIA, {
      heroMappings: new Map(),
      metaTeamHeroNames: new Set(['gulgortz'])
    })
    expect(result.map((u) => u.id)).toEqual(['gulgortz'])
  })

  it('empty meta-team set means the filter is inactive', () => {
    expect(filterAndSortUnits(units, DEFAULT_CRITERIA, NO_META)).toHaveLength(4)
  })
})

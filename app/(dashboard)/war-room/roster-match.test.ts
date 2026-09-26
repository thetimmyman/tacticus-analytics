import { describe, expect, it } from 'vitest'
import { HeroCatalog } from '@/app/lib/catalogs/heroes'
import { buildRosterIndex, findRosterHero } from './roster-match'

describe('War Room roster identity matching', () => {
  it('matches a canonical catalog id to a native roster id', () => {
    const catalog = new HeroCatalog([
      {
        unitId: 'sibyll-devine',
        displayName: 'Sibyll',
        faction: 'Imperium',
        traits: [],
        iconUrl: '',
        category: 'hero',
        engineId: 'astraPrimarisPsy'
      }
    ])
    const roster = buildRosterIndex([
      { id: 'Astra Primaris Psy', xpLevel: 42, rank: 9 }
    ])

    expect(findRosterHero('sibyll-devine', catalog, roster)?.xpLevel).toBe(42)
  })

  it('resolves a machine of war through its native id', () => {
    const catalog = new HeroCatalog([])
    const mow = {
      id: 'necroReanimator',
      engineId: 'necroReanimator',
      category: 'mow'
    }

    expect(
      findRosterHero('necroReanimator', catalog, buildRosterIndex([mow]))
    ).toBe(mow)
  })
})

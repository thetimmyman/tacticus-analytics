import { describe, expect, it } from 'vitest'
import type { CatalogHero } from '@/app/lib/catalogs/types'
import {
  compareTeamUnitNamesForDisplay,
  isKnownMachineOfWarName,
  sortTeamUnitNamesForDisplay
} from '@/app/lib/team-display-order'

const catalog = {
  getByName: (name: string) => {
    const values: Record<string, CatalogHero> = {
      rho: {
        displayName: 'Exitor-Rho-1.15/x',
        category: 'hero',
        unitId: 'rho',
        faction: 'Imperium',
        traits: [],
        iconUrl: ''
      },
      biovore: {
        displayName: 'Biovore',
        category: 'mow',
        unitId: 'biovore',
        faction: 'Chaos',
        traits: [],
        iconUrl: ''
      },
      galatian: {
        displayName: 'Galatian',
        category: 'mow',
        unitId: 'galatian',
        faction: 'Chaos',
        traits: [],
        iconUrl: ''
      }
    }
    return values[name.toLowerCase()] ?? null
  },
  getById: (id: string) => {
    const values: Record<string, CatalogHero> = {
      hero_zed_id: {
        displayName: 'Alpha Hero',
        category: 'hero',
        unitId: 'hero_zed_id',
        faction: 'Imperium',
        traits: [],
        iconUrl: ''
      },
      hero_alpha_id: {
        displayName: 'Zed Hero',
        category: 'hero',
        unitId: 'hero_alpha_id',
        faction: 'Imperium',
        traits: [],
        iconUrl: ''
      }
    }
    return values[id] ?? null
  }
}

describe('team display ordering', () => {
  it('sorts heroes by resolved display name instead of source order', () => {
    expect(
      sortTeamUnitNamesForDisplay(['Rho', 'hero_alpha_id', 'hero_zed_id'], {
        catalog
      })
    ).toEqual(['hero_zed_id', 'Rho', 'hero_alpha_id'])
  })

  it('puts machines of war last even when alphabetically early', () => {
    expect(
      sortTeamUnitNamesForDisplay(['Biovore', 'Ahriman', 'Abraxas'], {
        catalog
      })
    ).toEqual(['Abraxas', 'Ahriman', 'Biovore'])
  })

  it('keeps imported replay and atlas teams visually equivalent', () => {
    const replayOrder = ['Tangida', 'Actus', 'Rho', 'Trajann', 'BossGulgortz']
    const atlasOrder = ['Actus', 'BossGulgortz', 'Tangida', 'Trajann', 'Rho']

    expect(sortTeamUnitNamesForDisplay(replayOrder, { catalog })).toEqual(
      sortTeamUnitNamesForDisplay(atlasOrder, { catalog })
    )
  })

  it('uses fallback MoW names when catalog data is not available yet', () => {
    expect(isKnownMachineOfWarName('Plagueburst Crawler')).toBe(true)
    expect(compareTeamUnitNamesForDisplay('Biovore', 'Yazaghor')).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import {
  compareTeamUnitNamesForDisplay,
  isKnownMachineOfWarName,
  sortTeamUnitNamesForDisplay
} from '@/app/lib/team-display-order'

const catalog = {
  getByName: (name: string) => {
    const values: Record<
      string,
      { displayName: string; category: 'hero' | 'mow' }
    > = {
      rho: { displayName: 'Exitor-Rho-1.15/x', category: 'hero' },
      biovore: { displayName: 'Biovore', category: 'mow' },
      galatian: { displayName: 'Galatian', category: 'mow' }
    }
    return values[name.toLowerCase()] ?? null
  },
  getById: (id: string) => {
    const values: Record<
      string,
      { displayName: string; category: 'hero' | 'mow' }
    > = {
      hero_zed_id: { displayName: 'Alpha Hero', category: 'hero' },
      hero_alpha_id: { displayName: 'Zed Hero', category: 'hero' }
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

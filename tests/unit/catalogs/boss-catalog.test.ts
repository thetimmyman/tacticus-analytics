import { describe, expect, it } from 'vitest'
import { BossCatalog } from '@/app/lib/catalogs'
import type { CatalogBoss } from '@/app/lib/catalogs'

describe('BossCatalog', () => {
  const bosses: CatalogBoss[] = [
    {
      bossId: 'magnus',
      displayName: 'Magnus',
      faction: 'Unknown',
      turnLimit: 0,
      setNumber: 9,
      portraits: {
        icon: '/icons/magnus.png',
        thumbnail: '/thumbnails/magnus.png',
        portrait: '/portraits/magnus.png'
      },
      traits: ['Boss', 'Immune'],
      tiers: [{ tier: 'L1', health: 100, damage: 10, armor: 5 }],
      boards: [{ id: 'arena', name: 'Arena' }],
      bossType: 'Magnus',
      primes: [
        {
          bossId: 'aethana',
          displayName: 'Aethana',
          encounterIndex: 1,
          portraits: {
            icon: '/icons/aethana.png',
            thumbnail: '/thumbnails/aethana.png',
            portrait: '/portraits/aethana.png'
          }
        }
      ]
    },
    {
      bossId: 'belisarius',
      displayName: 'Belisarius Cawl',
      faction: 'Unknown',
      turnLimit: 0,
      setNumber: 10,
      portraits: {
        icon: '/icons/cawl.png',
        thumbnail: '/thumbnails/cawl.png',
        portrait: '/portraits/cawl.png'
      },
      tiers: [],
      boards: [],
      bossType: 'Belisarius'
    }
  ]

  const catalog = new BossCatalog({
    bosses,
    mappings: [
      {
        id: 1,
        boss_type: 'Magnus',
        boss_name: 'Magnus',
        encounter_index: 0,
        unit_id: 'GuildBoss9Boss1ThousMagnus',
        icon_path: null,
        portrait_path: null,
        thumbnail_path: null,
        asset_slug: null,
        map_metadata: null,
        map_display_name: null,
        map_slug: null,
        map_variant: null
      },
      {
        id: 2,
        boss_type: 'Magnus',
        boss_name: 'Aethana',
        encounter_index: 1,
        unit_id: 'GuildBoss9MiniBoss1ThousSorcerer',
        icon_path: null,
        portrait_path: null,
        thumbnail_path: null,
        asset_slug: null,
        map_metadata: null,
        map_display_name: null,
        map_slug: null,
        map_variant: null
      },
      {
        id: 3,
        boss_type: 'Belisarius',
        boss_name: 'Belisarius Cawl',
        encounter_index: 0,
        unit_id: 'GuildBoss10Boss1AdmecBelisarius',
        icon_path: '/icons/cawl.png',
        portrait_path: '/portraits/cawl.png',
        thumbnail_path: '/thumbnails/cawl.png',
        asset_slug: null,
        map_metadata: null,
        map_display_name: null,
        map_slug: null,
        map_variant: null
      }
    ]
  })

  it('gets bosses by id and name', () => {
    expect(catalog.getById('magnus')?.displayName).toBe('Magnus')
    expect(catalog.getByName('magnus')?.bossId).toBe('magnus')
  })

  it('resolves prime names to parent boss', () => {
    expect(catalog.getByName('Aethana')?.bossId).toBe('magnus')
  })

  it('returns portraits and tiers', () => {
    expect(catalog.getPortrait('magnus', 'icon')).toBe('/icons/magnus.png')
    expect(catalog.getTiers('magnus')).toHaveLength(1)
  })

  it('filters by set number and exposes mappings', () => {
    expect(catalog.getBySetNumber(9)).toHaveLength(1)
    expect(catalog.getMappings()).toHaveLength(3)
  })

  it('hydrates exact prime unit ids from live mapping rows', () => {
    expect(catalog.getById('magnus')?.primes?.[0]).toEqual(
      expect.objectContaining({
        displayName: 'Aethana',
        encounterIndex: 1,
        unitId: 'GuildBoss9MiniBoss1ThousSorcerer'
      })
    )
    expect(
      catalog.getPortrait('GuildBoss9MiniBoss1ThousSorcerer', 'icon')
    ).toBe('/icons/aethana.png')
  })

  it('resolves replay-native aliases and exact unit ids to Cawl artwork', () => {
    expect(catalog.getByName('BelisariusRW')?.displayName).toBe(
      'Belisarius Cawl'
    )
    expect(catalog.getById('GuildBoss10Boss1AdmecBelisarius')?.bossId).toBe(
      'belisarius'
    )
    expect(catalog.getPortrait('BelisariusRW', 'icon')).toBe('/icons/cawl.png')
    expect(
      catalog.getPortrait('GuildBoss10Boss1AdmecBelisarius:23', 'icon')
    ).toBe('/icons/cawl.png')
  })
})

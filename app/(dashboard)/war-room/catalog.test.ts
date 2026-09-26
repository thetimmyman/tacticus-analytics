import { describe, expect, it } from 'vitest'
import { HeroCatalog } from '@/app/lib/catalogs/heroes'
import { warRoomCatalog } from './catalog'

describe('War Room catalog alias projection', () => {
  it('preserves unavailable and empty catalogs', () => {
    expect(warRoomCatalog(undefined)).toBeUndefined()
    const empty = new HeroCatalog([])
    expect(warRoomCatalog(empty)).toBe(empty)
    expect(empty.getAll()).toHaveLength(0)
  })

  it('adds a lookup-only Shiron alias without duplicating the shared row', () => {
    const base = new HeroCatalog([
      {
        unitId: 'emperNoiseMarine',
        displayName: 'Shiron',
        iconUrl: '/images/shiron.png',
        faction: "Emperor's Children",
        traits: [],
        category: 'hero',
        engineId: 'emperNoiseMarine'
      }
    ])
    const enriched = warRoomCatalog(base)

    expect(enriched?.getAll()).toHaveLength(1)
    expect(enriched?.getAll()[0]?.unitId).toBe('emperNoiseMarine')
    expect(enriched?.getById('shiron')?.engineId).toBe('emperNoiseMarine')
    expect(enriched?.getById('shiron')?.iconUrl).toBe('/images/shiron.png')
    expect(enriched?.getById('shiron')).toBe(
      enriched?.getByNativeId('emperNoiseMarine')
    )
    expect(base.getById('shiron')).toBeNull()
    expect(warRoomCatalog(enriched)).toBe(enriched)
  })
})

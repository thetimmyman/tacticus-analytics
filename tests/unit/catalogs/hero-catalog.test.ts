import { describe, expect, it } from 'vitest'
import { HeroCatalog } from '@/app/lib/catalogs'
import type { CatalogHero } from '@/app/lib/catalogs'

describe('HeroCatalog', () => {
  const heroes: CatalogHero[] = [
    {
      unitId: 'alpha',
      displayName: 'Alpha',
      faction: 'Test',
      traits: [],
      iconUrl: '/icons/alpha.png',
      category: 'hero',
      dbId: 42,
      discordEmoji: '<:alpha:123>'
    },
    {
      unitId: 'beta-1',
      displayName: 'Beta One',
      faction: 'Test',
      traits: [],
      iconUrl: '/icons/beta.png',
      category: 'hero'
    },
    {
      unitId: 'admecRuststalker',
      displayName: 'Exitor-Rho-1.15/x',
      faction: 'Adeptus Mechanicus',
      traits: [],
      iconUrl: '/icons/rho.png',
      category: 'hero'
    }
  ]

  const catalog = new HeroCatalog(heroes)

  it('gets by id with normalization', () => {
    expect(catalog.getById('alpha')?.displayName).toBe('Alpha')
    expect(catalog.getById('ALPHA')?.displayName).toBe('Alpha')
  })

  it('gets by name with normalization', () => {
    expect(catalog.getByName('beta one')?.unitId).toBe('beta-1')
    expect(catalog.getByName('Beta-One')?.unitId).toBe('beta-1')
  })

  it('resolves the Rho replay alias to Exitor-Rho', () => {
    expect(catalog.getByName('Rho')?.unitId).toBe('admecRuststalker')
    expect(catalog.getByName(' r-h-o ')?.unitId).toBe('admecRuststalker')
    expect(catalog.getByName('Exitor-Rho-1.15/X')?.displayName).toBe(
      'Exitor-Rho-1.15/x'
    )
  })

  it('does not resolve the Rho alias when Exitor-Rho is absent', () => {
    const catalogWithoutRho = new HeroCatalog(
      heroes.filter((hero) => hero.unitId !== 'admecRuststalker')
    )

    expect(catalogWithoutRho.getByName('Rho')).toBeNull()
  })

  it('resolves the Rho alias after a display_name rebalance (unit_id anchor)', () => {
    // A balance patch bumps display_name; the alias must resolve via stable unit_id.
    const rebalanced = new HeroCatalog(
      heroes.map((hero) =>
        hero.unitId === 'admecRuststalker'
          ? { ...hero, displayName: 'Exitor-Rho-1.16/x' }
          : hero
      )
    )
    expect(rebalanced.getByName('Rho')?.unitId).toBe('admecRuststalker')
    expect(rebalanced.search('rho').map((h) => h.unitId)).toContain(
      'admecRuststalker'
    )
  })

  it('resolves the Calgar playbook alias to Marneus Calgar', () => {
    const withCalgar = new HeroCatalog([
      ...heroes,
      {
        unitId: 'ultraCalgar',
        displayName: 'Marneus Calgar',
        faction: 'Ultramarines',
        traits: [],
        iconUrl: '/icons/calgar.png',
        category: 'hero'
      }
    ])
    expect(withCalgar.getByName('Calgar')?.unitId).toBe('ultraCalgar')
    expect(withCalgar.getByName('calgar')?.unitId).toBe('ultraCalgar')
  })

  it("resolves Z'Kar bidirectionally regardless of which name is the display_name", () => {
    const renamed = new HeroCatalog([
      ...heroes,
      {
        unitId: 'thousDaemonPrince',
        displayName: "Z'Kar",
        faction: 'Thousand Sons',
        traits: [],
        iconUrl: '/icons/zkar.png',
        category: 'mow'
      }
    ])
    expect(renamed.getByName("Z'Kar")?.unitId).toBe('thousDaemonPrince')
    expect(renamed.getByName('Thous Daemon Prince')?.unitId).toBe(
      'thousDaemonPrince'
    )

    // Pre-rename data: both names must resolve (deploy-order safety).
    const legacy = new HeroCatalog([
      ...heroes,
      {
        unitId: 'thousDaemonPrince',
        displayName: 'Thous Daemon Prince',
        faction: 'Thousand Sons',
        traits: [],
        iconUrl: '/icons/zkar.png',
        category: 'mow'
      }
    ])
    expect(legacy.getByName("Z'Kar")?.unitId).toBe('thousDaemonPrince')
    expect(legacy.getByName('Thous Daemon Prince')?.unitId).toBe(
      'thousDaemonPrince'
    )
  })

  it('search matches alias sides as well as canonical names', () => {
    const withAliases = new HeroCatalog([
      ...heroes,
      {
        unitId: 'thousDaemonPrince',
        displayName: "Z'Kar",
        faction: 'Thousand Sons',
        traits: [],
        iconUrl: '/icons/zkar.png',
        category: 'mow'
      }
    ])
    expect(withAliases.search('daemon prince').map((h) => h.unitId)).toContain(
      'thousDaemonPrince'
    )
    expect(withAliases.search("z'kar").map((h) => h.unitId)).toContain(
      'thousDaemonPrince'
    )
    expect(withAliases.search('rho').map((h) => h.unitId)).toContain(
      'admecRuststalker'
    )
  })

  it('searches across ids and names', () => {
    const results = catalog.search('beta')
    expect(results).toHaveLength(1)
    expect(results[0]?.unitId).toBe('beta-1')
  })

  it('gets by numeric db id', () => {
    expect(catalog.getByDbId(42)?.unitId).toBe('alpha')
    expect(catalog.getByDbId(999)).toBeNull()
    expect(catalog.getByDbId(null)).toBeNull()
    expect(catalog.getByDbId(undefined)).toBeNull()
  })

  it('carries the discord emoji through the catalog', () => {
    expect(catalog.getById('alpha')?.discordEmoji).toBe('<:alpha:123>')
    expect(catalog.getById('beta-1')?.discordEmoji).toBeUndefined()
  })

  it('returns icons when available', () => {
    expect(catalog.getIcon('beta-1')).toBe('/icons/beta.png')
  })
})

/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { promises as fs } from 'node:fs'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mockLogger
}))

const importFresh = async () => {
  vi.resetModules()
  return import('@/app/lib/player/item-catalog')
}

describe('item-catalog', () => {
  beforeEach(() => {
    mockLogger.warn.mockClear()
    mockLogger.error.mockClear()
  })

  it('resolves all three Mythic relics directly from bundled items.json without fallback warnings', async () => {
    const { loadItemTypeMap } = await importFresh()
    const resolved = await loadItemTypeMap([
      'R_Crit_Fidelity',
      'R_Defensive_Thrydderghyre',
      'R_Booster_Block_LionHelmRelic'
    ])

    expect(resolved.get('R_Crit_Fidelity')).toBe('I_Crit')
    expect(resolved.get('R_Defensive_Thrydderghyre')).toBe('I_Defensive')
    expect(resolved.get('R_Booster_Block_LionHelmRelic')).toBe(
      'I_Booster_Block'
    )
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('agrees with inferItemTypeFromId for every item in bundled items.json', async () => {
    const { inferItemTypeFromId } = await importFresh()
    const raw = await fs.readFile(
      path.join(process.cwd(), 'data', 'game-data', 'items.json'),
      'utf8'
    )
    const items = JSON.parse(raw) as Record<string, { itemType?: string }>
    const entries = Object.entries(items)
    expect(entries.length).toBeGreaterThanOrEqual(217)

    for (const [id, entry] of entries) {
      expect(inferItemTypeFromId(id)).toBe(entry.itemType)
    }
  })

  it('classifies future uncatalogued canonical Snowprint item IDs via prefix fallback and warns once', async () => {
    const { loadItemTypeMap } = await importFresh()
    const first = await loadItemTypeMap([
      'R_Crit_SyntheticFutureRelic',
      'R_Block_SyntheticFutureRelic',
      'R_Defensive_SyntheticFutureRelic',
      'R_Booster_Crit_SyntheticFutureRelic',
      'R_Booster_Block_SyntheticFutureRelic',
      'I_Crit_SyntheticFutureItem',
      'synthetic-unknown-item',
      'R_Crit'
    ])

    expect(first.get('R_Crit_SyntheticFutureRelic')).toBe('I_Crit')
    expect(first.get('R_Block_SyntheticFutureRelic')).toBe('I_Block')
    expect(first.get('R_Defensive_SyntheticFutureRelic')).toBe('I_Defensive')
    expect(first.get('R_Booster_Crit_SyntheticFutureRelic')).toBe(
      'I_Booster_Crit'
    )
    expect(first.get('R_Booster_Block_SyntheticFutureRelic')).toBe(
      'I_Booster_Block'
    )
    expect(first.get('I_Crit_SyntheticFutureItem')).toBe('I_Crit')
    expect(first.has('synthetic-unknown-item')).toBe(false)
    expect(first.has('R_Crit')).toBe(false)
    expect(mockLogger.warn).toHaveBeenCalledTimes(6)

    mockLogger.warn.mockClear()
    const second = await loadItemTypeMap(['R_Crit_SyntheticFutureRelic'])
    expect(second.get('R_Crit_SyntheticFutureRelic')).toBe('I_Crit')
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('fails closed without prefix fallback when items.json cannot be loaded', async () => {
    const readSpy = vi
      .spyOn(fs, 'readFile')
      .mockRejectedValueOnce(new Error('ENOENT'))
    try {
      const { loadItemTypeMap } = await importFresh()
      const resolved = await loadItemTypeMap(['R_Crit_SyntheticFutureRelic'])
      expect(resolved.size).toBe(0)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'ENOENT' }),
        expect.stringContaining('Failed to load item catalog')
      )
    } finally {
      readSpy.mockRestore()
    }
  })

  it('resolves the four newly added units in bundled game-data unit catalog', async () => {
    vi.resetModules()
    const { getUnitCatalog } = await import('@/app/lib/player/unit-catalog')
    const { GAME_DATA_ROOT } = await import('@/app/lib/data/game-data-root')
    const catalog = await getUnitCatalog(GAME_DATA_ROOT)

    expect(catalog.aliases?.get('orksweirdboy')).toBe('zapspitta')
    expect(catalog.heroes.has('zapspitta')).toBe(true)
    expect(catalog.display?.get('zapspitta')).toEqual({
      name: 'Zapspitta',
      faction: 'Orks',
      grandAlliance: 'Xenos'
    })

    expect(catalog.aliases?.get('lostafearmonger')).toBe('daras')
    expect(catalog.heroes.has('daras')).toBe(true)
    expect(catalog.display?.get('daras')).toEqual({
      name: 'Daras',
      faction: 'TheLostAndTheDamned',
      grandAlliance: 'Chaos'
    })

    expect(catalog.aliases?.get('lostabile')).toBe('fabius-bile')
    expect(catalog.heroes.has('fabius-bile')).toBe(true)
    expect(catalog.display?.get('fabius-bile')).toEqual({
      name: 'Fabius Bile',
      faction: 'TheLostAndTheDamned',
      grandAlliance: 'Chaos'
    })

    expect(catalog.aliases?.get('custodreadnought')).toBe('boudicari')
    expect(catalog.mows.has('boudicari')).toBe(true)
    expect(catalog.heroes.has('boudicari')).toBe(false)
    expect(catalog.display?.get('boudicari')).toEqual({
      name: 'Boudicari',
      faction: 'Custodes',
      grandAlliance: 'Imperial'
    })
  })
})

/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'

vi.mock('node:fs', async () => ({
  promises: {
    readFile: vi.fn(),
    readdir: vi.fn()
  }
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

const readFileMock = fs.readFile as unknown as ReturnType<typeof vi.fn>
const readdirMock = fs.readdir as unknown as ReturnType<typeof vi.fn>

const FLAT_RECORD_HEROES = JSON.stringify({
  tigurius: { name: 'Tigurius' },
  certus: { name: 'Certus' },
  abaddon: { name: 'Abaddon', longName: 'Abaddon the Despoiler' }
})

const FLAT_RECORD_MOWS = JSON.stringify({
  ultraSmnInceptor: { name: 'Inceptor' },
  necronWarrior: { name: 'Necron Warrior' }
})

const LINEUP_MOW = JSON.stringify({
  id: 'malleus-rocket-launcher',
  gameId: 'astraOrdnanceBattery',
  name: 'Malleus Rocket Launcher',
  traits: ['MachineOfWar']
})

const LEGACY_HEROES = JSON.stringify({
  heroes: [
    { id: 'tigurius', name: 'Tigurius' },
    { id: 'certus', name: 'Certus' }
  ]
})

const LEGACY_MOWS = JSON.stringify({
  machines: {
    inceptor: { id: 'inceptor', name: 'Inceptor' }
  }
})

const importFresh = async () => {
  vi.resetModules()
  return import('@/app/lib/player/unit-catalog')
}

describe('getUnitCatalog', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    readdirMock.mockReset()
    readdirMock.mockResolvedValue([])
  })

  it('loads flat lineup records without treating flat summon statics as MoWs', async () => {
    readdirMock.mockResolvedValue(['malleus-rocket-launcher.json'])
    readFileMock.mockImplementation(async (p: string) => {
      if (p.endsWith('heroes_index.json')) return FLAT_RECORD_HEROES
      if (p.endsWith('machines_of_war.json')) return FLAT_RECORD_MOWS
      if (p.endsWith('malleus-rocket-launcher.json')) return LINEUP_MOW
      throw new Error(`unexpected path: ${p}`)
    })

    const { getUnitCatalog } = await importFresh()
    const catalog = await getUnitCatalog('/repo')

    expect(catalog.heroes.has('tigurius')).toBe(true)
    expect(catalog.heroes.has('certus')).toBe(true)
    expect(catalog.heroes.has('abaddon')).toBe(true)
    expect(catalog.heroes.size).toBe(3)
    expect(catalog.mows).toEqual(new Set(['malleus-rocket-launcher']))
    expect(catalog.mows.has('ultraSmnInceptor')).toBe(false)
    expect(catalog.mows.has('necronWarrior')).toBe(false)
  })

  it('still loads the legacy { heroes: [...] } / { machines: {...} } shape', async () => {
    readFileMock.mockImplementation(async (p: string) => {
      if (p.endsWith('heroes_index.json')) return LEGACY_HEROES
      if (p.endsWith('machines_of_war.json')) return LEGACY_MOWS
      throw new Error(`unexpected path: ${p}`)
    })

    const { getUnitCatalog } = await importFresh()
    const catalog = await getUnitCatalog('/repo')

    expect(catalog.heroes.has('tigurius')).toBe(true)
    expect(catalog.heroes.has('certus')).toBe(true)
    expect(catalog.mows.has('inceptor')).toBe(true)
  })

  it('builds case-insensitive aliases from name + longName so API ids resolve to engine ids', async () => {
    readdirMock.mockResolvedValue(['malleus-rocket-launcher.json'])
    readFileMock.mockImplementation(async (p: string) => {
      if (p.endsWith('heroes_index.json')) return FLAT_RECORD_HEROES
      if (p.endsWith('machines_of_war.json')) return FLAT_RECORD_MOWS
      if (p.endsWith('malleus-rocket-launcher.json')) return LINEUP_MOW
      throw new Error(`unexpected path: ${p}`)
    })

    const { getUnitCatalog } = await importFresh()
    const catalog = await getUnitCatalog('/repo')

    expect(catalog.aliases.get('tigurius')).toBe('tigurius')
    expect(catalog.aliases.get('abaddonthedespoiler')).toBe('abaddon')
    expect(catalog.aliases.get('malleusrocketlauncher')).toBe(
      'malleus-rocket-launcher'
    )
    expect(catalog.aliases.has('inceptor')).toBe(false)
  })
})

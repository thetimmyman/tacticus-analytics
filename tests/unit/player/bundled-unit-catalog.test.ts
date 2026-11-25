/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GAME_DATA_ROOT } from '@/app/lib/data/game-data-root'
import { getUnitCatalog } from '@/app/lib/player/unit-catalog'

describe('bundled unit catalog', () => {
  it('resolves newly added playable heroes and Machines of War from bundled game-data', async () => {
    const catalog = await getUnitCatalog(GAME_DATA_ROOT)

    expect(catalog.aliases?.get('orksweirdboy')).toBe('zapspitta')
    expect(catalog.aliases?.get('lostabile')).toBe('fabius-bile')
    expect(catalog.aliases?.get('lostafearmonger')).toBe('daras')
    expect(catalog.aliases?.get('astareradicator')).toBe('nubari')
    expect(catalog.aliases?.get('custodreadnought')).toBe('boudicari')

    expect(catalog.heroes.has('zapspitta')).toBe(true)
    expect(catalog.heroes.has('fabius-bile')).toBe(true)
    expect(catalog.heroes.has('daras')).toBe(true)
    expect(catalog.heroes.has('nubari')).toBe(true)

    expect(catalog.mows.has('boudicari')).toBe(true)
    expect(catalog.heroes.has('boudicari')).toBe(false)
  })

  it('keeps heroes/*.json and heroes_index.json aligned with unique gameIds', () => {
    const heroesDir = path.join(GAME_DATA_ROOT, 'heroes')
    const index = JSON.parse(
      fs.readFileSync(path.join(GAME_DATA_ROOT, 'heroes_index.json'), 'utf8')
    ) as Record<string, { id: string; file: string }>

    const files = fs
      .readdirSync(heroesDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
    const seenGameIds = new Set<string>()

    expect(files.length).toBe(Object.keys(index).length)
    for (const file of files) {
      const hero = JSON.parse(
        fs.readFileSync(path.join(heroesDir, file), 'utf8')
      ) as { id: string; gameId: string }
      expect(index[hero.id]).toBeDefined()
      expect(index[hero.id]?.file).toBe(`heroes/${file}`)
      expect(seenGameIds.has(hero.gameId)).toBe(false)
      seenGameIds.add(hero.gameId)
    }
  })
})

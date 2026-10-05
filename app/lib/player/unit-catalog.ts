import 'server-only'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('player.unit-catalog')

export type UnitDisplayMetadata = {
  name?: string
  faction?: string
  grandAlliance?: string
}

export interface UnitCatalog {
  heroes: Set<string>
  mows: Set<string>
  aliases?: Map<string, string>
  display?: Map<string, UnitDisplayMetadata>
}

let cachedCatalog: UnitCatalog | null = null
let cachedPromise: Promise<UnitCatalog> | null = null

const normalizeUnitKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const addAlias = (
  aliases: Map<string, string>,
  raw: string | undefined,
  id: string
) => {
  if (!raw) return
  const key = normalizeUnitKey(raw)
  if (!key || aliases.has(key)) return
  aliases.set(key, id)
}

// Partitions per-unit JSON ids by the `MachineOfWar` trait. The current
// `machines_of_war.json` holds summon statics, not selectable units.
const loadHeroDetails = async (heroesDir: string) => {
  const heroIds = new Set<string>()
  const mowIds = new Set<string>()
  const display = new Map<string, UnitDisplayMetadata>()
  const aliases = new Map<string, string>()
  try {
    const entries = await fs.readdir(heroesDir)
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.endsWith('.json')) return
        try {
          const raw = await fs.readFile(path.join(heroesDir, entry), 'utf8')
          const parsed = JSON.parse(raw) as {
            id?: string
            gameId?: string
            name?: string
            longName?: string
            factionId?: string
            allianceId?: string
            traits?: unknown
          }
          if (!parsed?.id) return
          const id = String(parsed.id)
          const metadata: UnitDisplayMetadata = {}
          if (typeof parsed.name === 'string' && parsed.name.trim())
            metadata.name = parsed.name.trim()
          if (typeof parsed.factionId === 'string' && parsed.factionId.trim())
            metadata.faction = parsed.factionId.trim()
          if (
            typeof parsed.allianceId === 'string' &&
            ['Imperial', 'Chaos', 'Xenos'].includes(parsed.allianceId)
          )
            metadata.grandAlliance = parsed.allianceId
          display.set(id, metadata)
          const isMow =
            Array.isArray(parsed.traits) &&
            parsed.traits.includes('MachineOfWar')
          ;(isMow ? mowIds : heroIds).add(id)
          addAlias(aliases, id, id)
          addAlias(aliases, parsed.gameId, id)
          addAlias(aliases, parsed.name, id)
          addAlias(aliases, parsed.longName, id)
        } catch (error) {
          // Skip just the bad file; rejecting Promise.all would wipe the union that repairs a stale index.
          logger.warn(
            {
              file: entry,
              error: error instanceof Error ? error.message : String(error)
            },
            'Skipping unreadable hero data file'
          )
        }
      })
    )
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'heroes/ directory unreadable; skipping per-hero union'
    )
  }
  return { heroIds, mowIds, aliases, display }
}

type CatalogEntry = {
  id?: string
  name?: string
  longName?: string
  gameId?: string
}

// Accepts legacy `{ heroes: [...] }` and current keyed `{ "<id>": {...} }`
// shapes; an explicit `id` field wins over the key so renames are not masked.
const collectCatalogEntries = (
  parsed: unknown,
  arrayKey: 'heroes' | 'machines',
  options: { allowFlatRoot?: boolean } = {}
): Array<{ id: string; entry: CatalogEntry }> => {
  if (!parsed || typeof parsed !== 'object') return []
  const root = parsed as Record<string, unknown>
  const legacy = root[arrayKey]
  const out: Array<{ id: string; entry: CatalogEntry }> = []

  if (Array.isArray(legacy)) {
    legacy.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const e = entry as CatalogEntry
      if (!e.id) return
      out.push({ id: String(e.id), entry: e })
    })
    return out
  }

  if (legacy && typeof legacy === 'object') {
    Object.entries(legacy as Record<string, unknown>).forEach(
      ([key, entry]) => {
        if (!entry || typeof entry !== 'object') return
        const e = entry as CatalogEntry
        const id = e.id ? String(e.id) : key
        out.push({ id, entry: e })
      }
    )
    return out
  }

  if (options.allowFlatRoot === false) return out

  Object.entries(root).forEach(([key, entry]) => {
    if (!entry || typeof entry !== 'object') return
    const e = entry as CatalogEntry
    const id = e.id ? String(e.id) : key
    out.push({ id, entry: e })
  })
  return out
}

const loadHeroes = async (pathToFile: string) => {
  const raw = await fs.readFile(pathToFile, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  const ids = new Set<string>()
  const aliases = new Map<string, string>()
  collectCatalogEntries(parsed, 'heroes').forEach(({ id, entry }) => {
    ids.add(id)
    addAlias(aliases, id, id)
    addAlias(aliases, entry.name, id)
    addAlias(aliases, entry.longName, id)
    addAlias(aliases, entry.gameId, id)
  })
  return { ids, aliases }
}

const loadMows = async (pathToFile: string) => {
  const raw = await fs.readFile(pathToFile, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  const ids = new Set<string>()
  const aliases = new Map<string, string>()
  // No flat root: selectable MoWs come from heroes/*.json via the `MachineOfWar` trait.
  collectCatalogEntries(parsed, 'machines', { allowFlatRoot: false }).forEach(
    ({ id, entry }) => {
      ids.add(id)
      addAlias(aliases, id, id)
      addAlias(aliases, entry.name, id)
      addAlias(aliases, entry.longName, id)
      addAlias(aliases, entry.gameId, id)
    }
  )
  return { ids, aliases }
}

export const getUnitCatalog = async (repoPath: string) => {
  if (cachedCatalog) return cachedCatalog
  if (cachedPromise) return cachedPromise

  cachedPromise = (async () => {
    const heroesPath = path.join(repoPath, 'heroes_index.json')
    const mowsPath = path.join(repoPath, 'machines_of_war.json')
    const heroesDir = path.join(repoPath, 'heroes')
    const [heroes, mows, heroDetails] = await Promise.all([
      loadHeroes(heroesPath),
      loadMows(mowsPath),
      loadHeroDetails(heroesDir)
    ])
    const aliases = new Map<string, string>()
    heroes.aliases.forEach((value, key) => {
      if (!aliases.has(key)) aliases.set(key, value)
    })
    heroDetails.aliases.forEach((value, key) => {
      if (!aliases.has(key)) aliases.set(key, value)
    })
    mows.aliases.forEach((value, key) => {
      if (!aliases.has(key)) aliases.set(key, value)
    })
    // Union per-unit ids so a stale index cannot strip units; trait MoWs move to the MoW set.
    const mergedHeroIds = new Set<string>(heroes.ids)
    heroDetails.heroIds.forEach((id) => mergedHeroIds.add(id))
    const mergedMowIds = new Set<string>(mows.ids)
    heroDetails.mowIds.forEach((id) => mergedMowIds.add(id))
    mergedMowIds.forEach((id) => mergedHeroIds.delete(id))
    cachedCatalog = {
      heroes: mergedHeroIds,
      mows: mergedMowIds,
      aliases,
      display: heroDetails.display
    }
    if (mergedHeroIds.size === 0 || mergedMowIds.size === 0) {
      // Empty sets make every unit 'unknown'. Log basenames only: absolute paths leak container layout.
      logger.error(
        {
          heroCount: mergedHeroIds.size,
          heroesIndexCount: heroes.ids.size,
          heroDetailsCount: heroDetails.heroIds.size,
          heroDetailsMowCount: heroDetails.mowIds.size,
          mowCount: mergedMowIds.size,
          mowsIndexCount: mows.ids.size,
          heroesFile: path.basename(heroesPath),
          mowsFile: path.basename(mowsPath)
        },
        'Unit catalog loaded with empty sets — classifyUnitId will return "unknown" for every player unit. Verify game-data file shapes.'
      )
    }
    return cachedCatalog
  })().finally(() => {
    cachedPromise = null
  })

  return cachedPromise
}

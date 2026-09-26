import { useQuery } from '@tanstack/react-query'
// Client logger: client hooks import this module and next build rejects server-only imports.
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('lib.catalogs.heroes')
import { dbClient } from '@/app/lib/db/client'
import { CACHE_CONFIG, getCatalogCache, setCatalogCache } from './cache'
import type { CatalogHero, CatalogHeroCategory } from './types'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

/** Server code with its own transport must select exactly this and map through `mapHeroRow`. */
export const HERO_MAPPINGS_SELECT =
  'id, unit_id, display_name, web_icon_url, icon_url, category, game_id, discord_emoji'

export interface HeroMappingRow {
  id?: number | null
  unit_id: string
  display_name: string | null
  web_icon_url: string | null
  icon_url?: string | null
  category?: string | null
  game_id?: string | null
  discord_emoji?: string | null
}

const HERO_FALLBACK: CatalogHero[] = [
  {
    unitId: 'eldryon',
    displayName: 'Eldryon',
    faction: 'Aeldari',
    traits: ['Psyker'],
    iconUrl: '',
    category: 'hero'
  },
  {
    unitId: 'maugan-ra',
    displayName: 'Maugan Ra',
    faction: 'Aeldari',
    traits: ['Heavy Weapon'],
    iconUrl: '',
    category: 'hero'
  },
  {
    unitId: 'calandis',
    displayName: 'Calandis',
    faction: 'Aeldari',
    traits: ['Sniper'],
    iconUrl: '',
    category: 'hero'
  },
  {
    unitId: 'bellator',
    displayName: 'Bellator',
    faction: 'Imperium',
    traits: ['Flying'],
    iconUrl: '',
    category: 'hero'
  },
  {
    unitId: 'aleph-null',
    displayName: 'Aleph-Null',
    faction: 'Necrons',
    traits: ['Mechanical'],
    iconUrl: '',
    category: 'hero'
  }
]

const normalizeHeroKey = normalizeIdentifier

/** Keyed on stable unit_id so resolution survives display_name renames. */
const HERO_NAME_ALIASES = [
  {
    unitId: 'admecRuststalker',
    names: ['Rho', 'Exitor-Rho-1.15/x']
  },
  {
    // The pre-rename name stays resolvable so either deploy order is safe.
    unitId: 'thousDaemonPrince',
    names: ["Z'Kar", 'Thous Daemon Prince']
  },
  {
    unitId: 'ultraCalgar',
    names: ['Calgar', 'Marneus Calgar']
  }
] as const

const normalizeHeroCategory = (value?: string | null): CatalogHeroCategory => {
  if (!value) return 'unknown'
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('mow') || normalized.includes('machine')) {
    return 'mow'
  }
  if (normalized.includes('hero')) {
    return 'hero'
  }
  return 'unknown'
}

export const mapHeroRow = (row: HeroMappingRow): CatalogHero => {
  const displayName = row.display_name?.trim() || row.unit_id
  const iconUrl = row.web_icon_url || row.icon_url || ''
  return {
    unitId: row.unit_id,
    displayName,
    faction: 'Unknown',
    traits: [],
    iconUrl,
    portraitUrl: iconUrl || undefined,
    category: normalizeHeroCategory(row.category),
    engineId: row.game_id ?? undefined,
    dbId: row.id ?? undefined,
    discordEmoji: row.discord_emoji ?? undefined
  }
}

/** Never substitutes HERO_FALLBACK: API responses must not fabricate identities. */
export const buildHeroCatalog = (
  rows: HeroMappingRow[] | null | undefined
): HeroCatalog => new HeroCatalog((rows ?? []).map(mapHeroRow))

export class HeroCatalog {
  private readonly heroes: CatalogHero[]
  private readonly byId = new Map<string, CatalogHero>()
  private readonly byName = new Map<string, CatalogHero>()
  private readonly byNativeId = new Map<string, CatalogHero>()
  private readonly byDbId = new Map<number, CatalogHero>()
  private readonly searchKeys = new Map<CatalogHero, string[]>()

  constructor(heroes: CatalogHero[]) {
    this.heroes = heroes
    heroes.forEach((hero) => {
      const idKey = normalizeHeroKey(hero.unitId)
      const nameKey = normalizeHeroKey(hero.displayName)
      this.byId.set(hero.unitId, hero)
      this.byId.set(idKey, hero)
      this.byName.set(nameKey, hero)
      this.byName.set(hero.displayName.toLowerCase(), hero)
      if (hero.engineId) this.byNativeId.set(hero.engineId, hero)
      if (hero.dbId != null) this.byDbId.set(hero.dbId, hero)
      this.searchKeys.set(hero, [idKey, nameKey])
    })

    // Never clobber a name already owned by a different real hero.
    HERO_NAME_ALIASES.forEach(({ unitId, names }) => {
      const hero = this.byId.get(unitId)
      if (!hero) return
      const keys = this.searchKeys.get(hero)
      for (const name of names) {
        const key = normalizeHeroKey(name)
        const existing = this.byName.get(key)
        if (existing && existing !== hero) continue
        if (!existing) this.byName.set(key, hero)
        if (keys && !keys.includes(key)) keys.push(key)
      }
    })
  }

  getById(unitId: string): CatalogHero | null {
    if (!unitId) return null
    const direct = this.byId.get(unitId)
    if (direct) return direct
    return this.byId.get(normalizeHeroKey(unitId)) ?? null
  }

  getByName(name: string): CatalogHero | null {
    if (!name) return null
    const normalized = normalizeHeroKey(name)
    return this.byName.get(normalized) ?? null
  }

  getByDbId(dbId: number | null | undefined): CatalogHero | null {
    if (dbId == null) return null
    return this.byDbId.get(dbId) ?? null
  }

  getByNativeId(gameId: string): CatalogHero | null {
    if (!gameId) return null
    return this.byNativeId.get(gameId) ?? null
  }

  getAll(): CatalogHero[] {
    return [...this.heroes]
  }

  search(query: string): CatalogHero[] {
    const normalized = normalizeHeroKey(query || '')
    if (!normalized) return this.getAll()
    return this.heroes.filter((hero) =>
      (this.searchKeys.get(hero) ?? []).some((key) => key.includes(normalized))
    )
  }

  getIcon(unitId: string): string {
    return this.getById(unitId)?.iconUrl || ''
  }
}

let cachedHeroCatalog: HeroCatalog | null = null
let cachedHeroCatalogPromise: Promise<HeroCatalog> | null = null

export async function loadHeroCatalog(): Promise<HeroCatalog> {
  if (cachedHeroCatalog) return cachedHeroCatalog
  if (cachedHeroCatalogPromise) return cachedHeroCatalogPromise

  cachedHeroCatalogPromise = (async () => {
    const cached = getCatalogCache<CatalogHero[]>('heroes')
    if (cached && cached.length > 0) {
      cachedHeroCatalog = new HeroCatalog(cached)
      return cachedHeroCatalog
    }

    try {
      const supabase = dbClient()
      const { data, error } = await supabase
        .from('hero_mappings')
        .select(HERO_MAPPINGS_SELECT)
        .order('display_name')

      if (error) throw error

      const heroes = (data || []).map(mapHeroRow)
      const finalHeroes = heroes.length > 0 ? heroes : HERO_FALLBACK
      setCatalogCache('heroes', finalHeroes, CACHE_CONFIG.heroes.ttl)
      cachedHeroCatalog = new HeroCatalog(finalHeroes)
      return cachedHeroCatalog
    } catch (error) {
      logger.warn({ error }, 'Hero catalog fetch failed, using fallback')
      // For this call only, so the next call retries instead of pinning placeholders.
      return new HeroCatalog(HERO_FALLBACK)
    } finally {
      cachedHeroCatalogPromise = null
    }
  })()

  return cachedHeroCatalogPromise
}

export function useHeroCatalog() {
  return useQuery({
    queryKey: ['hero-catalog'],
    queryFn: loadHeroCatalog,
    staleTime: CACHE_CONFIG.heroes.ttl,
    gcTime: CACHE_CONFIG.heroes.ttl * 2
  })
}

import { useQuery } from '@tanstack/react-query'
// Client logger: client hooks import this module.
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('lib.catalogs.bosses')
import { dbClient } from '@/app/lib/db/client'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'
import {
  normalizeBossKey as normalizeCanonicalBossKey,
  stripNonAlnumLower
} from '@/app/lib/resolvers/boss-identity'
import {
  buildPortraits,
  buildFallbackPath,
  normalizeBossSlug
} from '@/app/lib/resolvers/boss-assets'
import {
  REAL_BOSS_OPTIONS,
  resolveBossTraits
} from './boss-data/real-boss-data'
import { CACHE_CONFIG, getCatalogCache, setCatalogCache } from './cache'
import type {
  CatalogBoss,
  CatalogBossBoard,
  CatalogBossPortraits,
  CatalogBossTier
} from './types'

interface BossMappingRow {
  id: number
  boss_type: string
  boss_name: string
  encounter_index: number
  unit_id: string | null
  icon_path: string | null
  portrait_path: string | null
  thumbnail_path: string | null
  asset_slug: string | null
  map_metadata: unknown
  map_display_name: string | null
  map_slug: string | null
  map_variant: string | null
}

interface BossCatalogPayload {
  bosses: CatalogBoss[]
  mappings: BossMappingRow[]
}

// Deliberately not normalizeBossKey: grouping needs the exact key, without variant collapsing.
const normalizeBossGroupKey = stripNonAlnumLower
const withoutReplayInstanceSuffix = (value: string): string =>
  value.replace(/:\d+$/, '')

const parseSetNumber = (unitId?: string | null): number => {
  if (!unitId) return 0
  const match = unitId.match(/GuildBoss(\d+)/i)
  if (!match) return 0
  const parsed = parseInt(match[1] ?? '0', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const realBossIndex = (() => {
  const index = new Map<string, (typeof REAL_BOSS_OPTIONS)[number]>()
  REAL_BOSS_OPTIONS.forEach((boss) => {
    index.set(normalizeBossGroupKey(boss.id), boss)
    index.set(normalizeBossGroupKey(boss.name), boss)
  })
  return index
})()

const mapBossTiers = (
  tiers?: (typeof REAL_BOSS_OPTIONS)[number]['tiers']
): CatalogBossTier[] => {
  if (!tiers) return []
  return tiers.map((tier) => ({
    tier: tier.name,
    health: tier.health,
    damage: tier.damage,
    armor: tier.armor
  }))
}

const mapBossBoards = (
  row?: BossMappingRow,
  realBoss?: (typeof REAL_BOSS_OPTIONS)[number]
): CatalogBossBoard[] => {
  const metadata = Array.isArray(row?.map_metadata)
    ? (row?.map_metadata as Array<{
        mapSlug?: string
        difficultyCode?: string
      }>)
    : []

  if (metadata.length > 0) {
    return metadata.map((entry, index) => {
      const id = entry.mapSlug || `${row?.boss_type || 'boss'}_${index}`
      return {
        id,
        name: row?.map_display_name || entry.mapSlug || 'Boss Arena'
      }
    })
  }

  if (realBoss?.maps?.length) {
    return realBoss.maps.map((map) => ({
      id: map.id,
      name: map.name,
      imageUrl: map.imageUrl || map.previewImage || map.backgroundImage
    }))
  }

  return []
}

const buildBosses = (rows: BossMappingRow[]): CatalogBoss[] => {
  const grouped = new Map<string, BossMappingRow[]>()
  rows.forEach((row) => {
    if (!row?.boss_type) return
    const key = normalizeBossGroupKey(row.boss_type)
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  })

  const bosses: CatalogBoss[] = []
  grouped.forEach((entries) => {
    const mainRow =
      entries.find((entry) => entry.encounter_index === 0) ?? entries[0]
    const bossType = mainRow?.boss_type || entries[0]?.boss_type || 'Unknown'
    const displayName =
      mainRow?.boss_name?.trim() || getBossDisplayName(bossType)
    const bossId = normalizeBossGroupKey(bossType || displayName)
    const realBoss =
      realBossIndex.get(normalizeBossGroupKey(displayName)) ||
      realBossIndex.get(normalizeBossGroupKey(bossType))
    const primes = entries
      .filter((entry) => entry.encounter_index > 0)
      .map((entry) => ({
        bossId: normalizeBossGroupKey(entry.boss_name || entry.boss_type),
        displayName: entry.boss_name || entry.boss_type,
        encounterIndex: entry.encounter_index,
        unitId: entry.unit_id || undefined,
        portraits: buildPortraits(entry)
      }))

    bosses.push({
      bossId,
      displayName,
      faction: 'Unknown',
      bannedFaction: undefined,
      turnLimit: 0,
      setNumber: parseSetNumber(mainRow?.unit_id),
      portraits: buildPortraits(mainRow),
      traits: resolveBossTraits(
        mainRow?.unit_id,
        bossType,
        displayName,
        realBoss?.id,
        realBoss?.name
      ),
      tiers: mapBossTiers(realBoss?.tiers),
      boards: mapBossBoards(mainRow, realBoss),
      bossType,
      encounterIndex: mainRow?.encounter_index,
      unitId: mainRow?.unit_id || undefined,
      primes
    })
  })

  return bosses
}

const buildFallbackBosses = (): CatalogBoss[] => {
  return REAL_BOSS_OPTIONS.map((boss) => ({
    bossId: normalizeBossGroupKey(boss.id),
    displayName: boss.name,
    faction: 'Unknown',
    bannedFaction: undefined,
    turnLimit: 0,
    setNumber: 0,
    portraits: {
      icon: buildFallbackPath(normalizeBossSlug(boss.id), 'icon'),
      thumbnail: buildFallbackPath(normalizeBossSlug(boss.id), 'thumbnail'),
      portrait: buildFallbackPath(normalizeBossSlug(boss.id), 'portrait')
    },
    traits: boss.traits,
    tiers: mapBossTiers(boss.tiers),
    boards: boss.maps.map((map) => ({
      id: map.id,
      name: map.name,
      imageUrl: map.imageUrl || map.previewImage || map.backgroundImage
    })),
    bossType: boss.name
  }))
}

export class BossCatalog {
  private readonly bosses: CatalogBoss[]
  private readonly mappings: BossMappingRow[]
  private readonly byId = new Map<string, CatalogBoss>()
  private readonly byName = new Map<string, CatalogBoss>()
  private readonly byCanonicalAlias = new Map<string, CatalogBoss | null>()
  private readonly portraitsByAlias = new Map<string, CatalogBossPortraits>()
  private readonly portraitsByCanonicalAlias = new Map<
    string,
    CatalogBossPortraits | null
  >()

  constructor(payload: BossCatalogPayload) {
    this.mappings = payload.mappings
    const mappingByGroupAndEncounter = new Map<string, BossMappingRow>()
    payload.mappings.forEach((mapping) => {
      mappingByGroupAndEncounter.set(
        `${normalizeBossGroupKey(mapping.boss_type)}:${mapping.encounter_index}`,
        mapping
      )
    })
    // Cached payloads may predate prime unit ids; rehydrate them from the raw
    // mappings so exact replay identity works immediately.
    this.bosses = payload.bosses.map((boss) => {
      const groupKey = normalizeBossGroupKey(boss.bossType || boss.bossId)
      const mainMapping = mappingByGroupAndEncounter.get(
        `${groupKey}:${boss.encounterIndex ?? 0}`
      )
      return {
        ...boss,
        unitId: boss.unitId || mainMapping?.unit_id || undefined,
        primes: boss.primes?.map((prime) => {
          const mapping = mappingByGroupAndEncounter.get(
            `${groupKey}:${prime.encounterIndex}`
          )
          return {
            ...prime,
            unitId: prime.unitId || mapping?.unit_id || undefined,
            portraits:
              prime.portraits ?? (mapping ? buildPortraits(mapping) : undefined)
          }
        })
      }
    })

    this.bosses.forEach((boss) => {
      this.indexAlias(boss.bossId, boss, boss.portraits, true)
      this.indexAlias(boss.displayName, boss, boss.portraits, true)
      this.indexAlias(boss.bossType, boss, boss.portraits, true)
      this.indexAlias(boss.unitId, boss, boss.portraits, false)
      boss.primes?.forEach((prime) => {
        const portraits = prime.portraits ?? boss.portraits
        this.indexAlias(prime.bossId, boss, portraits, false)
        this.indexAlias(prime.displayName, boss, portraits, false)
        this.indexAlias(prime.unitId, boss, portraits, false)
      })
    })
  }

  private indexAlias(
    value: string | null | undefined,
    boss: CatalogBoss,
    portraits: CatalogBossPortraits,
    canonicalFallback: boolean
  ): void {
    if (!value) return
    const plain = normalizeBossGroupKey(value)
    this.byId.set(value, boss)
    this.byId.set(plain, boss)
    this.byName.set(plain, boss)
    this.portraitsByAlias.set(value, portraits)
    this.portraitsByAlias.set(plain, portraits)

    if (!canonicalFallback) return
    const canonical = normalizeCanonicalBossKey(value)
    if (!canonical) return

    const existingBoss = this.byCanonicalAlias.get(canonical)
    if (existingBoss === undefined || existingBoss === boss) {
      this.byCanonicalAlias.set(canonical, boss)
    } else {
      // Ambiguous aliases (e.g. the three Hive Tyrants): never let insertion order pick.
      this.byCanonicalAlias.set(canonical, null)
    }

    const existingPortraits = this.portraitsByCanonicalAlias.get(canonical)
    if (existingPortraits === undefined || existingPortraits === portraits) {
      this.portraitsByCanonicalAlias.set(canonical, portraits)
    } else {
      this.portraitsByCanonicalAlias.set(canonical, null)
    }
  }

  getById(bossId: string): CatalogBoss | null {
    if (!bossId) return null
    const baseId = withoutReplayInstanceSuffix(bossId)
    return (
      this.byId.get(bossId) ??
      this.byId.get(baseId) ??
      this.byId.get(normalizeBossGroupKey(baseId)) ??
      this.byCanonicalAlias.get(normalizeCanonicalBossKey(baseId)) ??
      null
    )
  }

  getByName(name: string): CatalogBoss | null {
    if (!name) return null
    const baseName = withoutReplayInstanceSuffix(name)
    return (
      this.byName.get(normalizeBossGroupKey(baseName)) ??
      this.byCanonicalAlias.get(normalizeCanonicalBossKey(baseName)) ??
      null
    )
  }

  getAll(): CatalogBoss[] {
    return [...this.bosses]
  }

  getPortrait(
    bossId: string,
    variant: keyof CatalogBossPortraits = 'portrait'
  ): string {
    const baseId = withoutReplayInstanceSuffix(bossId)
    const portraits =
      this.portraitsByAlias.get(bossId) ??
      this.portraitsByAlias.get(baseId) ??
      this.portraitsByAlias.get(normalizeBossGroupKey(baseId)) ??
      this.portraitsByCanonicalAlias.get(normalizeCanonicalBossKey(baseId))
    if (portraits) return portraits[variant] || ''
    const boss = this.getById(bossId) || this.getByName(bossId)
    if (!boss) return ''
    return boss.portraits[variant] || ''
  }

  getTiers(bossId: string): CatalogBossTier[] {
    return this.getById(bossId)?.tiers ?? []
  }

  getBySetNumber(setNum: number): CatalogBoss[] {
    return this.bosses.filter((boss) => boss.setNumber === setNum)
  }

  getMappings(): BossMappingRow[] {
    return [...this.mappings]
  }
}

let cachedBossCatalog: BossCatalog | null = null
let cachedBossCatalogPromise: Promise<BossCatalog> | null = null

export async function loadBossCatalog(): Promise<BossCatalog> {
  if (cachedBossCatalog) return cachedBossCatalog
  if (cachedBossCatalogPromise) return cachedBossCatalogPromise

  cachedBossCatalogPromise = (async () => {
    const cached = getCatalogCache<BossCatalogPayload>('bosses')
    if (cached?.bosses?.length) {
      cachedBossCatalog = new BossCatalog(cached)
      return cachedBossCatalog
    }

    try {
      const supabase = dbClient()
      const { data, error } = await supabase
        .from('boss_mapping')
        .select(
          'id, boss_type, boss_name, encounter_index, unit_id, icon_path, portrait_path, thumbnail_path, asset_slug, map_metadata, map_display_name, map_slug, map_variant'
        )
        .order('boss_type')

      if (error) throw error

      const mappings = (data || []) as BossMappingRow[]
      const bosses =
        mappings.length > 0 ? buildBosses(mappings) : buildFallbackBosses()
      const payload = { bosses, mappings }
      setCatalogCache('bosses', payload, CACHE_CONFIG.bosses.ttl)
      cachedBossCatalog = new BossCatalog(payload)
      return cachedBossCatalog
    } catch (error) {
      logger.warn({ error }, 'Boss catalog fetch failed, using fallback')
      const payload = { bosses: buildFallbackBosses(), mappings: [] }
      cachedBossCatalog = new BossCatalog(payload)
      return cachedBossCatalog
    } finally {
      cachedBossCatalogPromise = null
    }
  })()

  return cachedBossCatalogPromise
}

export function useBossCatalog() {
  return useQuery({
    queryKey: ['boss-catalog'],
    queryFn: loadBossCatalog,
    staleTime: CACHE_CONFIG.bosses.ttl,
    gcTime: CACHE_CONFIG.bosses.ttl * 2
  })
}

import 'server-only'
import { stripGuildBossPrefix } from '@/app/lib/discord/formatters'
import { parseEncounterIndexFromBossId } from '@/app/lib/resolvers/boss-identity'
import playbooksCatalog from '@/data/boss-playbooks/playbooks.json'

// Sync sends `Magnus_E0`, UI test-fire sends per-encounter ids; both must resolve to one slug.
const normalizePlaybookSlug = (slug: string): string =>
  slug.toLowerCase().replace(/-/g, '')

let normalizedSlugLookupCache: Map<string, string> | null = null
const getNormalizedSlugLookup = (): Map<string, string> => {
  if (normalizedSlugLookupCache) return normalizedSlugLookupCache
  const map = new Map<string, string>()
  const catalog = playbooksCatalog as {
    bosses?: Array<{
      id?: string
      tacticusTableIds?: {
        boss?: string
        prime1?: string
        prime2?: string
      }
    }>
  }
  const bosses = Array.isArray(catalog.bosses) ? catalog.bosses : []
  for (const b of bosses) {
    if (typeof b.id !== 'string') continue
    const slug = b.id
    map.set(normalizePlaybookSlug(slug), slug)
    const ids = b.tacticusTableIds ?? {}
    for (const raw of [ids.boss, ids.prime1, ids.prime2]) {
      const stripped = stripGuildBossPrefix(raw)
      if (!stripped) continue
      map.set(stripped.toLowerCase(), slug)
    }
  }
  normalizedSlugLookupCache = map
  return map
}
export const heraldBossIdToPlaybookSlug = (
  heraldBossId: string
): string | null => {
  const match = heraldBossId.match(/^([A-Za-z][A-Za-z0-9]*)_E\d+$/)
  const bossType = match?.[1]
  if (!bossType) return null
  const lookup = getNormalizedSlugLookup()
  const direct = lookup.get(bossType.toLowerCase())
  if (direct) return direct
  // Reworked bosses gain `RW` in sync; fall back to the base name.
  if (bossType.endsWith('RW')) {
    return lookup.get(bossType.slice(0, -2).toLowerCase()) ?? null
  }
  return null
}

export const heraldBossIdToCatalogBossUnitId = (
  heraldBossId: string
): string | null => {
  const slug = heraldBossIdToPlaybookSlug(heraldBossId)
  const encounterIndex = parseEncounterIndexFromBossId(heraldBossId)
  if (!slug || encounterIndex === null || encounterIndex > 2) return null

  const catalog = playbooksCatalog as {
    bosses?: Array<{
      id?: string
      tacticusTableIds?: {
        boss?: string
        prime1?: string
        prime2?: string
      }
    }>
  }
  const boss = catalog.bosses?.find((entry) => entry.id === slug)
  const ids = boss?.tacticusTableIds
  const unitId =
    encounterIndex === 0
      ? ids?.boss
      : encounterIndex === 1
        ? ids?.prime1
        : ids?.prime2
  return typeof unitId === 'string' && unitId.trim() ? unitId.trim() : null
}

export const parseReplayStageToken = (
  raritySetToken: string | null
): { rarity: 'Legendary' | 'Mythic'; setNumber: number } | null => {
  const match = raritySetToken?.match(/^([LM])(\d{1,2})$/)
  if (!match?.[1] || !match[2]) return null
  const level = Number.parseInt(match[2], 10)
  if (!Number.isSafeInteger(level) || level < 1 || level > 21) return null
  return {
    rarity: match[1] === 'M' ? 'Mythic' : 'Legendary',
    setNumber: level - 1
  }
}

// Mirrors SQL `get_rarity_set(rarity, set)`.
export const rarityToRaritySet = (
  rarity: string,
  set: number | null
): string | null => {
  if (set === null) return null
  const lower = rarity.toLowerCase()
  if (lower === 'legendary') return `L${set + 1}`
  if (lower === 'mythic') return `M${set + 1}`
  return null
}

export const mainBossIdForGroup = (bossId: string): string =>
  bossId.replace(/_E[12]$/, '_E0')

// Pure, client-safe boss name/key/id logic. The two override tables deliberately serve one function each.

export const stripNonAlnumLower = (value?: string | null): string => {
  if (!value) return ''
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const normalizeBossKey = (value?: string | null): string => {
  if (!value) return ''
  const cleaned = stripNonAlnumLower(value)
  if (cleaned.startsWith('tervigon')) return 'tervigon'
  if (cleaned.startsWith('hivetyrant')) return 'hive_tyrant'
  if (cleaned.startsWith('screamerkiller')) return 'screamer_killer'
  if (cleaned.startsWith('rogaldorn')) return 'rogaldorn'
  if (cleaned.startsWith('avatarofkhaine')) return 'avatarofkhaine'
  if (cleaned.startsWith('belisarius')) return 'belisarius'
  if (cleaned.startsWith('mortarian') || cleaned.startsWith('mortarion'))
    return 'mortarion'
  if (
    cleaned.startsWith('silentking') ||
    cleaned.startsWith('thesilentking') ||
    cleaned.startsWith('szarekh')
  )
    return 'silentking'
  return cleaned
}

/** Must cover every rotation boss or the raw slug leaks (boss-display-rotation-coverage.test.ts). */
export const BOSS_NAME_OVERRIDES: Record<string, string> = {
  avatarofkhaine: 'Avatar of Khaine',
  belisarius: 'Belisarius Cawl',
  belisariuscawl: 'Belisarius Cawl',
  belisariusrw: 'Belisarius Cawl',
  ghazghkull: 'Ghazghkull Thraka',
  mortarian: 'Mortarion',
  mortarion: 'Mortarion',
  silentking: 'Szarekh',
  szarekh: 'Szarekh',
  thesilentking: 'Szarekh',
  rogaldorn: 'Rogal Dorn',
  screamer_killer: 'Screamer Killer',
  hive_tyrant: 'Hive Tyrant',
  hivetyrant: 'Hive Tyrant',
  hivetyrantgorgon: 'Hive Tyrant (Gorgon)',
  hivetyrantleviathan: 'Hive Tyrant (Leviathan)',
  hivetyrantkronos: 'Hive Tyrant (Kronos)',
  lion: "Lion El'Jonson",
  magnus: 'Magnus the Red',
  magnusthered: 'Magnus the Red',
  riptide: 'Riptide',
  tervigon: 'Tervigon',
  tervigongorgon: 'Tervigon (Gorgon)',
  tervigonleviathan: 'Tervigon (Leviathan)',
  tervigonkronos: 'Tervigon (Kronos)',
  boss2: 'Experimental Boss'
}

const humanize = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()

/** Un-collapsed key first (variant-specific overrides), then normalizeBossKey output, then humanization. */
export const getBossDisplayName = (rawName?: string | null): string => {
  if (!rawName) {
    return 'Unknown Boss'
  }

  const exactKey = stripNonAlnumLower(rawName)
  if (exactKey && BOSS_NAME_OVERRIDES[exactKey]) {
    return BOSS_NAME_OVERRIDES[exactKey]
  }

  const normalized = normalizeBossKey(rawName)
  if (normalized && BOSS_NAME_OVERRIDES[normalized]) {
    return BOSS_NAME_OVERRIDES[normalized]
  }

  const fallback = humanize(rawName).replace(
    /(^|\s)([a-z])/g,
    (_, sp, ch) => sp + ch.toUpperCase()
  )
  return fallback.length > 0 ? fallback : 'Unknown Boss'
}

export const VARIANT_LABELS = new Set(['Leviathan', 'Gorgon', 'Kronos'])

/** prettyBossName's table: boss_type tokens whose humanization would leak an internal suffix ('RW'). */
export const PRETTY_BOSS_NAME_OVERRIDES: Record<string, string> = {
  belisariusrw: 'Belisarius Cawl',
  belisarius: 'Belisarius Cawl'
}

export const prettyBossName = (
  bossType: string,
  variant?: string | null
): string => {
  if (!variant) {
    const overrideKey = stripNonAlnumLower(bossType)
    if (PRETTY_BOSS_NAME_OVERRIDES[overrideKey]) {
      return PRETTY_BOSS_NAME_OVERRIDES[overrideKey]
    }
  }

  const parts = bossType
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)

  if (parts.length === 0) {
    return bossType
  }

  if (parts[0] === 'Hive' && parts[1] === 'Tyrant') {
    const base = 'Hive Tyrant'
    const suffix = parts.slice(2).join(' ') || variant
    return suffix ? `${base} (${suffix})` : base
  }

  if (parts.length > 1) {
    const base = parts[0]
    const suffix = parts.slice(1).join(' ')
    if (VARIANT_LABELS.has(suffix) || variant) {
      const label = variant || suffix
      return `${base} (${label})`
    }
    return `${parts[0]} ${parts.slice(1).join(' ')}`
  }

  // A single lowercase token is a canonical slug; resolve it rather than leak it.
  const single = parts[0]
  if (single === bossType && single === single.toLowerCase()) {
    const resolved = getBossDisplayName(single)
    return variant ? `${resolved} (${variant})` : resolved
  }

  return parts.join(' ')
}

/** Herald boss id; bare bossType when encounterIndex is null. */
export const buildBossId = (
  bossType: string,
  encounterIndex: number | null
): string =>
  encounterIndex !== null ? `${bossType}_E${encounterIndex}` : bossType

export const buildHeraldBossId = (
  bossType: string,
  encounterIndex: number
): string => `${bossType}_E${encounterIndex}`

export const parseEncounterIndexFromBossId = (
  bossId: string
): number | null => {
  const m = bossId.match(/_E(\d+)$/)
  const parsed = m?.[1] ? parseInt(m[1], 10) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

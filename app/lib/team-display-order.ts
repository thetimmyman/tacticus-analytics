import type { HeroCatalog } from '@/app/lib/catalogs/heroes'

type CatalogLookup = Pick<HeroCatalog, 'getById' | 'getByName'>

type SortTeamUnitOptions = {
  catalog?: CatalogLookup | null
  isMachineOfWar?: (unitName: string) => boolean | null | undefined
}

const UNIT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})

const normalizeUnitKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const KNOWN_MACHINE_OF_WAR_KEYS = new Set(
  [
    'Biovore',
    'Forgefiend',
    'Galatian',
    'Malleus Rocket Launcher',
    'MalleusRocketLauncher',
    'Plagueburst Crawler',
    'PlagueburstCrawler',
    'Plagueburst Mortar',
    'PlagueburstMortar',
    'Rukkatrukk',
    'Rukkatrukk Squigbuggy',
    'Storm Speeder',
    'Stormbird',
    // MoW names in hero_mappings (category='MOW'); without them external units sort mid-lineup.
    'Exorcist',
    'Reanimator',
    "Z'Kar",
    'Thous Daemon Prince',
    "T'Sonji",
    'Darka Storm Speeder'
  ].map(normalizeUnitKey)
)

const resolveCatalogUnit = (unitName: string, catalog?: CatalogLookup | null) =>
  catalog?.getByName(unitName) ?? catalog?.getById(unitName) ?? null

export const getTeamUnitDisplayName = (
  unitName: string,
  catalog?: CatalogLookup | null
) => resolveCatalogUnit(unitName, catalog)?.displayName?.trim() || unitName

export const isKnownMachineOfWarName = (
  unitName: string,
  catalog?: CatalogLookup | null
) => {
  const unit = resolveCatalogUnit(unitName, catalog)
  if (unit?.category === 'mow') return true

  const normalized = normalizeUnitKey(unitName.replace(/^\[MOW\]/i, ''))
  if (normalized.startsWith('mow')) return true
  if (KNOWN_MACHINE_OF_WAR_KEYS.has(normalized)) return true

  const displayName = unit?.displayName
  return displayName
    ? KNOWN_MACHINE_OF_WAR_KEYS.has(normalizeUnitKey(displayName))
    : false
}

export const compareTeamUnitNamesForDisplay = (
  left: string,
  right: string,
  options: SortTeamUnitOptions = {}
) => {
  const leftIsMow =
    options.isMachineOfWar?.(left) ??
    isKnownMachineOfWarName(left, options.catalog)
  const rightIsMow =
    options.isMachineOfWar?.(right) ??
    isKnownMachineOfWarName(right, options.catalog)

  if (leftIsMow !== rightIsMow) return leftIsMow ? 1 : -1

  const leftName = getTeamUnitDisplayName(left, options.catalog)
  const rightName = getTeamUnitDisplayName(right, options.catalog)
  const displayCompare = UNIT_COLLATOR.compare(leftName, rightName)
  if (displayCompare !== 0) return displayCompare

  return UNIT_COLLATOR.compare(left, right)
}

export const sortTeamUnitNamesForDisplay = <T extends string>(
  units: readonly T[],
  options: SortTeamUnitOptions = {}
): T[] =>
  [...units].sort((left, right) =>
    compareTeamUnitNamesForDisplay(left, right, options)
  )

import type { HeroCatalog } from '@/app/lib/catalogs'
import type { RosterHero } from '@/app/lib/hooks/shared/types'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

/** Indexed by every stable identity the roster endpoint supplies. */
export function buildRosterIndex(units: RosterHero[]): Map<string, RosterHero> {
  const index = new Map<string, RosterHero>()

  for (const unit of units) {
    for (const alias of [unit.id, unit.engineId, unit.name]) {
      const key = normalizeIdentifier(alias)
      if (key && !index.has(key)) index.set(key, unit)
    }
  }

  return index
}

/** Catalog unit IDs, native game IDs and display names are all valid in imported data. */
export function findRosterHero(
  unitId: string,
  catalog: HeroCatalog | undefined,
  index: Map<string, RosterHero>
): RosterHero | undefined {
  const canonical =
    catalog?.getById(unitId) ??
    catalog?.getByNativeId(unitId) ??
    catalog?.getByName(unitId)

  return [
    unitId,
    canonical?.unitId,
    canonical?.engineId,
    canonical?.displayName
  ]
    .map((alias) => normalizeIdentifier(alias))
    .filter(Boolean)
    .map((key) => index.get(key))
    .find(Boolean)
}

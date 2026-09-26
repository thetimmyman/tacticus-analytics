import { HeroCatalog } from '@/app/lib/catalogs/heroes'
import type { CatalogHero } from '@/app/lib/catalogs/types'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

const SHIRON_ALIAS = 'shiron'
const SHIRON_NATIVE_ID = 'emperNoiseMarine'

/** Lookup-only alias for the one identity whose native id differs, so Shiron is listed once. */
class WarRoomCatalog extends HeroCatalog {
  private readonly shiron: CatalogHero

  constructor(catalog: HeroCatalog, shiron: CatalogHero) {
    super(catalog.getAll())
    this.shiron = shiron
  }

  override getById(unitId: string): CatalogHero | null {
    const direct = super.getById(unitId)
    if (direct) return direct
    return normalizeIdentifier(unitId) === SHIRON_ALIAS ? this.shiron : null
  }
}

export function warRoomCatalog(
  catalog: HeroCatalog | undefined
): HeroCatalog | undefined {
  if (!catalog || catalog.getAll().length === 0) return catalog
  if (catalog.getById(SHIRON_ALIAS)) return catalog

  const nativeShiron = catalog.getByNativeId(SHIRON_NATIVE_ID)
  if (!nativeShiron) return catalog

  return new WarRoomCatalog(catalog, nativeShiron)
}

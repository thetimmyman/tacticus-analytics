export * from './types'
export * from './rarity-set'

export { HeroCatalog, loadHeroCatalog, useHeroCatalog } from './heroes'

export { BossCatalog, useBossCatalog } from './bosses'

import { loadHeroCatalog as loadHeroes } from './heroes'
import { loadBossCatalog as loadBosses } from './bosses'

export const initializeCatalogs = async () => {
  await Promise.all([loadHeroes(), loadBosses()])
}

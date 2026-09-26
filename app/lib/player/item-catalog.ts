import 'server-only'

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createComponentLogger } from '@/app/lib/logging'
import { GAME_DATA_ROOT } from '@/app/lib/data/game-data-root'

const logger = createComponentLogger('player.item-catalog')
const ITEMS_JSON_PATH = path.join(GAME_DATA_ROOT, 'items.json')

let cachedItemTypes: Map<string, string> | null = null

async function loadItemTypes(): Promise<Map<string, string>> {
  if (cachedItemTypes) return cachedItemTypes

  const itemTypes = new Map<string, string>()
  try {
    const raw = await fs.readFile(ITEMS_JSON_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [itemId, value] of Object.entries(
        parsed as Record<string, unknown>
      )) {
        if (!value || typeof value !== 'object') continue
        const itemType = (value as Record<string, unknown>).itemType
        if (typeof itemType === 'string' && itemType) {
          itemTypes.set(itemId, itemType)
        }
      }
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to load item catalog; equipment slots will remain unclassified'
    )
  }

  cachedItemTypes = itemTypes
  return itemTypes
}

export async function loadItemTypeMap(
  itemIds: Iterable<string>
): Promise<Map<string, string>> {
  const catalog = await loadItemTypes()
  const result = new Map<string, string>()
  for (const itemId of itemIds) {
    const itemType = catalog.get(itemId)
    if (itemType) result.set(itemId, itemType)
  }
  return result
}

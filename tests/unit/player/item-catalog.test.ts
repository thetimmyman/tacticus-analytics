/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GAME_DATA_ROOT } from '@/app/lib/data/game-data-root'
import { loadItemTypeMap } from '@/app/lib/player/item-catalog'
import { classifyRosterItems } from '@/app/lib/player/roster-sync'

const KNOWN_ROSTER_ITEM_TYPES = new Set([
  'I_Crit',
  'I_Block',
  'I_Defensive',
  'I_Booster_Crit',
  'I_Booster_Block'
])

describe('bundled item catalog', () => {
  it('classifies current Mythic relics into their roster equipment slots', async () => {
    const relicIds = [
      'R_Crit_Fidelity',
      'R_Defensive_Thrydderghyre',
      'R_Booster_Block_LionHelmRelic'
    ]
    const typeMap = await loadItemTypeMap(relicIds)

    expect(typeMap.get('R_Crit_Fidelity')).toBe('I_Crit')
    expect(typeMap.get('R_Defensive_Thrydderghyre')).toBe('I_Defensive')
    expect(typeMap.get('R_Booster_Block_LionHelmRelic')).toBe('I_Booster_Block')

    const classified = classifyRosterItems(
      [
        { id: 'R_Crit_Fidelity', level: 1 },
        { id: 'R_Defensive_Thrydderghyre', level: 4 },
        { id: 'R_Booster_Block_LionHelmRelic', level: 7 }
      ],
      typeMap
    )

    expect(classified).toEqual({
      crit_item_id: 'R_Crit_Fidelity',
      crit_item_level: 1,
      defensive_item_id: 'R_Defensive_Thrydderghyre',
      defensive_item_level: 4,
      booster_item_id: 'R_Booster_Block_LionHelmRelic',
      booster_item_level: 7
    })
  })

  it('assigns every bundled I_ and R_ equipment entry a known itemType', () => {
    const raw = fs.readFileSync(path.join(GAME_DATA_ROOT, 'items.json'), 'utf8')
    const catalog = JSON.parse(raw) as Record<string, { itemType?: string }>
    const equipmentEntries = Object.entries(catalog).filter(
      ([id]) => id.startsWith('I_') || id.startsWith('R_')
    )

    expect(equipmentEntries.length).toBeGreaterThan(200)
    for (const [id, entry] of equipmentEntries) {
      expect(
        KNOWN_ROSTER_ITEM_TYPES.has(entry.itemType ?? ''),
        `unexpected itemType for ${id}: ${String(entry.itemType)}`
      ).toBe(true)
    }
  })
})

import type { RawRaidEntry } from '@/app/lib/sync/transformers'
import { formatUnitDisplayName } from '@/app/lib/sync/transformers'
import {
  logger,
  getErrorMessage,
  type StrictSupabaseClient
} from '@/app/lib/sync/db-operations/shared'

type HeroDetail = {
  unitId?: string
  [key: string]: unknown
}

type MachineOfWarDetail = {
  unitId?: string
  [key: string]: unknown
}

type UnitTrackingInfo = {
  category: 'Hero' | 'MOW'
  firstSeen: string
}

export type UnitTrackingResult = {
  newUnits: number
  totalUnits: number
  newHeroes: number
  newMOWs: number
}

const EXCLUDED_UNIT_ID_PATTERNS = [
  /Boss/,
  /Npc/,
  /LHE$/,
  /LRE$/,
  /CE$/,
  /Surv$/,
  /LEG$/,
  /Camp$/,
  /^LootObj_/,
  /test$/,
  /RedGobbo/ // Survival mode only
]

const shouldTrackUnitId = (unitId?: string | null): unitId is string => {
  if (!unitId) return false
  const normalized = unitId.trim()
  if (!normalized) return false
  return !EXCLUDED_UNIT_ID_PATTERNS.some((pattern) => pattern.test(normalized))
}

export async function trackUnitIds(
  supabase: StrictSupabaseClient,
  entries: RawRaidEntry[],
  guildCode: string
): Promise<UnitTrackingResult> {
  const uniqueUnits = new Map<string, UnitTrackingInfo>()

  for (const entry of entries) {
    if (entry.heroDetails) {
      try {
        const heroes =
          typeof entry.heroDetails === 'string'
            ? JSON.parse(entry.heroDetails)
            : entry.heroDetails

        if (Array.isArray(heroes)) {
          for (const hero of heroes as HeroDetail[]) {
            const unitId = typeof hero.unitId === 'string' ? hero.unitId : null
            if (shouldTrackUnitId(unitId)) {
              uniqueUnits.set(unitId, {
                category: 'Hero',
                firstSeen: new Date().toISOString()
              })
            }
          }
        }
      } catch (error: unknown) {
        logger.debug(
          { guildCode },
          `Failed to parse heroDetails: ${getErrorMessage(error)}`
        )
      }
    }

    if (entry.machineOfWarDetails) {
      try {
        const mow =
          typeof entry.machineOfWarDetails === 'string'
            ? JSON.parse(entry.machineOfWarDetails)
            : entry.machineOfWarDetails

        const mowDetail = mow as MachineOfWarDetail | null
        const unitId =
          typeof mowDetail?.unitId === 'string' ? mowDetail.unitId : null
        if (shouldTrackUnitId(unitId)) {
          uniqueUnits.set(unitId, {
            category: 'MOW',
            firstSeen: new Date().toISOString()
          })
        }
      } catch (error: unknown) {
        logger.debug(
          { guildCode },
          `Failed to parse machineOfWarDetails: ${getErrorMessage(error)}`
        )
      }
    }
  }

  if (uniqueUnits.size === 0) {
    return {
      newUnits: 0,
      totalUnits: 0,
      newHeroes: 0,
      newMOWs: 0
    }
  }

  logger.info(
    { guildCode },
    `Found ${uniqueUnits.size} unique unit IDs in raid data`
  )

  const unitIds = Array.from(uniqueUnits.keys())
  const { data: existingMappings } = await supabase
    .from('hero_mappings')
    .select('unit_id')
    .in('unit_id', unitIds)

  const existingUnitIds = new Set(
    (existingMappings || []).map(
      (mapping: { unit_id: string }) => mapping.unit_id
    )
  )

  const newUnits: Array<{
    unit_id: string
    category: UnitTrackingInfo['category']
    display_name: string
    created_at: string
    updated_at: string
  }> = []
  for (const [unitId, info] of uniqueUnits.entries()) {
    if (!existingUnitIds.has(unitId)) {
      newUnits.push({
        unit_id: unitId,
        category: info.category,
        display_name: formatUnitDisplayName(unitId),
        created_at: info.firstSeen,
        updated_at: info.firstSeen
      })
    }
  }

  if (newUnits.length > 0) {
    const { error } = await supabase.from('hero_mappings').insert(newUnits)

    if (!error) {
      logger.info(
        { guildCode },
        `Successfully created ${newUnits.length} new hero mappings`
      )
    }
  }

  return {
    newUnits: newUnits.length,
    totalUnits: uniqueUnits.size,
    newHeroes: newUnits.filter((u) => u.category === 'Hero').length,
    newMOWs: newUnits.filter((u) => u.category === 'MOW').length
  }
}

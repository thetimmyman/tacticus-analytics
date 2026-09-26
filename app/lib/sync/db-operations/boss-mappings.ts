import type {
  ProcessedRaidEntry,
  RawRaidEntry,
  BossMappings
} from '@/app/lib/sync/transformers'
import {
  logger,
  type StrictSupabaseClient
} from '@/app/lib/sync/db-operations/shared'

export async function fetchBossMappings(
  supabase: StrictSupabaseClient
): Promise<BossMappings> {
  try {
    const { data, error } = await supabase
      .from('boss_mapping')
      .select('boss_type, encounter_index, boss_name')

    if (error) throw error

    const mappings: BossMappings = {}
    for (const row of data || []) {
      const bossType = typeof row?.boss_type === 'string' ? row.boss_type : null
      const encounterIndex =
        typeof row?.encounter_index === 'number' ? row.encounter_index : null
      const bossName = typeof row?.boss_name === 'string' ? row.boss_name : null

      if (!bossType || encounterIndex === null || !bossName) {
        continue
      }

      if (!mappings[bossType]) {
        mappings[bossType] = {}
      }
      mappings[bossType]![encounterIndex] = bossName
    }

    logger.info(
      { tag: 'SYSTEM', boss_type_count: Object.keys(mappings).length },
      'Loaded boss mappings'
    )
    return mappings
  } catch (error: unknown) {
    logger.error({ tag: 'SYSTEM', err: error }, 'Failed to fetch boss mappings')
    return {}
  }
}

export type BossMappingCoverage = {
  total: number
  mainBosses: number
  primeBosses: number
  mapped: number
  unmapped: number
  unknownBosses: number
  bossTypes: Set<string>
  unmappedTypes: Set<string>
}

export async function analyzeBossMappingCoverage(
  guildCode: string,
  processedData: ProcessedRaidEntry[]
): Promise<BossMappingCoverage> {
  const stats: BossMappingCoverage = {
    total: processedData.length,
    mainBosses: 0,
    primeBosses: 0,
    mapped: 0,
    unmapped: 0,
    unknownBosses: 0,
    bossTypes: new Set<string>(),
    unmappedTypes: new Set<string>()
  }

  for (const entry of processedData) {
    if (entry.encounterId === 0) {
      stats.mainBosses++
    } else if (entry.encounterId > 0) {
      stats.primeBosses++
    }

    if (entry.Name && entry.Name !== 'Unknown') {
      stats.mapped++
      stats.bossTypes.add(entry.Name)
    } else {
      stats.unmapped++
      if (entry.Name === 'Unknown') {
        stats.unknownBosses++
      }
      stats.unmappedTypes.add(entry.type || 'no-type')
    }
  }

  if (stats.unmapped > 0) {
    logger.info(
      { guildCode },
      `Boss mapping coverage: ${stats.mapped}/${stats.total} (${Math.round((stats.mapped / stats.total) * 100)}%)`
    )
  }

  return stats
}

type MissingMapping = {
  bossType: string
  encounterIndex: number
  mappingKey: string
  entryCount: number
}

export async function validateBossMappings(
  guildCode: string,
  entries: RawRaidEntry[],
  bossMappings: BossMappings
): Promise<{
  validated: boolean
  missingCount: number
  requiredCount: number
}> {
  const missingMappings: MissingMapping[] = []
  const existingMappings = new Set<string>()

  for (const [bossType, indices] of Object.entries(bossMappings)) {
    for (const encounterIndex of Object.keys(indices)) {
      existingMappings.add(`${bossType}:${encounterIndex}`)
    }
  }

  const requiredMappings = new Set<string>()
  for (const entry of entries) {
    const bossType = (entry.type || entry.encounterType || 'Unknown') as string
    const encounterIndexRaw =
      typeof entry.encounterIndex === 'number'
        ? entry.encounterIndex
        : parseInt(String(entry.encounterIndex ?? ''), 10)
    const encounterIndex = Number.isFinite(encounterIndexRaw)
      ? encounterIndexRaw
      : 0

    if (bossType && bossType !== 'Unknown' && encounterIndex > 0) {
      const mappingKey = `${bossType}:${encounterIndex}`
      requiredMappings.add(mappingKey)

      if (!existingMappings.has(mappingKey)) {
        missingMappings.push({
          bossType,
          encounterIndex,
          mappingKey,
          entryCount: entries.filter((e) => {
            const entryBossType = (e.type ||
              e.encounterType ||
              'Unknown') as string
            const parsedEncounter =
              typeof e.encounterIndex === 'number'
                ? e.encounterIndex
                : parseInt(String(e.encounterIndex ?? ''), 10)
            const entryEncounterIndex = Number.isFinite(parsedEncounter)
              ? parsedEncounter
              : 0
            return (
              entryBossType === bossType &&
              entryEncounterIndex === encounterIndex
            )
          }).length
        })
      }
    }
  }

  logger.info(
    { guildCode },
    `Required Prime boss mappings: ${requiredMappings.size}`
  )

  if (missingMappings.length > 0) {
    const uniqueMissing = [
      ...new Map(missingMappings.map((m) => [m.mappingKey, m])).values()
    ]
    logger.warn(
      { guildCode },
      `Missing ${uniqueMissing.length} Prime boss mappings`
    )
  }

  return {
    validated: true,
    missingCount: missingMappings.length,
    requiredCount: requiredMappings.size
  }
}

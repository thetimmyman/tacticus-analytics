import type { BossMappingCoverage } from '@/app/lib/sync/db-operations/boss-mappings'

export type SyncStats = {
  totalEntries: number
  validEntries: number
  processedEntries: number
  finalValidEntries: number
  upsertedEntries: number
  insertedEntries: number
  updatedEntries: number
  errorEntries: number
  lokiMappings: number
  totalMappings: number
  unmappedPlayers: number
  newHeroMappings: number
  totalUnits: number
  newHeroes: number
  newMOWs: number
  grRanking: number | null
  gwRanking: number | null
  bossMappingCoverage: {
    total: number
    mapped: number
    unmapped: number
    mainBosses: number
    primeBosses: number
    unknownBosses: number
    coveragePercent: number
  }
  bossMappingValidation: {
    required: number
    missing: number
  }
  executionTimeMs: number
}

export type SyncSuccessResponse = {
  success: true
  message: string
  guild_code: string
  season: string
  status: 'completed'
  recordsProcessed: number
  playersFound: number
  rankings: { guildRaid: number | null; guildWar: number | null }
  stats: SyncStats
  unmappedPlayers: string[]
  configPatched: boolean
}

export function buildSyncSuccessResponse(params: {
  guildCode: string
  season: string
  upserted: number
  inserted: number
  updated: number
  errors: number
  entries: { length: number }
  validEntries: { length: number }
  processedData: { length: number }
  finalValidData: Array<{ displayName: string | null; userId: string | null }>
  lokiMembers: { length: number }
  playerMappings: Map<string, string>
  heroTrackingResult: {
    newUnits: number
    totalUnits: number
    newHeroes: number
    newMOWs: number
  }
  mappingCoverage: BossMappingCoverage
  validationResult: { requiredCount: number; missingCount: number }
  rankings: { guildRaid: number | null; guildWar: number | null }
  executionTime: number
}): SyncSuccessResponse {
  const unmappedPlayers = params.finalValidData
    .filter((d) => d.displayName === d.userId && d.userId !== null)
    .map((d) => d.userId as string)
  const uniqueUnmapped = [...new Set(unmappedPlayers)]

  return {
    success: true,
    message: `Successfully synced ${params.upserted} records for ${params.lokiMembers.length} players`,
    guild_code: params.guildCode,
    season: params.season,
    status: 'completed',
    recordsProcessed: params.upserted,
    playersFound: params.lokiMembers.length,
    rankings: {
      guildRaid: params.rankings.guildRaid,
      guildWar: params.rankings.guildWar
    },
    stats: {
      totalEntries: params.entries.length,
      validEntries: params.validEntries.length,
      processedEntries: params.processedData.length,
      finalValidEntries: params.finalValidData.length,
      upsertedEntries: params.upserted,
      insertedEntries: params.inserted,
      updatedEntries: params.updated,
      errorEntries: params.errors,
      lokiMappings: params.lokiMembers.length,
      totalMappings: params.playerMappings.size / 2,
      unmappedPlayers: uniqueUnmapped.length,
      newHeroMappings: params.heroTrackingResult.newUnits,
      totalUnits: params.heroTrackingResult.totalUnits,
      newHeroes: params.heroTrackingResult.newHeroes,
      newMOWs: params.heroTrackingResult.newMOWs,
      grRanking: params.rankings.guildRaid,
      gwRanking: params.rankings.guildWar,
      bossMappingCoverage: {
        total: params.mappingCoverage.total,
        mapped: params.mappingCoverage.mapped,
        unmapped: params.mappingCoverage.unmapped,
        mainBosses: params.mappingCoverage.mainBosses,
        primeBosses: params.mappingCoverage.primeBosses,
        unknownBosses: params.mappingCoverage.unknownBosses,
        coveragePercent: Math.round(
          (params.mappingCoverage.mapped / params.mappingCoverage.total) * 100
        )
      },
      bossMappingValidation: {
        required: params.validationResult.requiredCount,
        missing: params.validationResult.missingCount
      },
      executionTimeMs: params.executionTime
    },
    unmappedPlayers: uniqueUnmapped.slice(0, 5),
    configPatched: true
  }
}

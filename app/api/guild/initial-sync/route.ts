import { NextRequest, NextResponse } from 'next/server'
import { resolveLokiIdentity } from '@/app/lib/loki/identity'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.initial-sync')
import { decryptApiKey } from '@tacticus/app-core/encryption'
import { validateGuildCode } from '@/app/lib/validation/schemas'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import {
  processRaidEntry,
  handleDuplicateDisplayNames,
  detectSeason,
  extractEntries,
  filterValidEntries,
  filterProcessedData,
  type LokiMember,
  type ProcessedRaidEntry
} from '@/app/lib/sync/transformers'
import {
  fetchBossMappings,
  validateBossMappings,
  analyzeBossMappingCoverage,
  beginGuildRosterObservation,
  savePlayerMappings,
  trackUnitIds,
  updateBombTracking,
  upsertDataBatches,
  updateSyncStatus,
  updateGuildConfigAfterSync,
  loadExistingPlayerMappings,
  getErrorMessage,
  buildSyncSuccessResponse
} from '@/app/lib/sync/db-operations'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  fetchGuildMembersViaTacticus,
  fetchGuildMembersViaLoki,
  fetchGuildRaidData,
  fetchGuildRankings,
  autoPatchGuildConfig,
  detectCurrentGWSeasonFromGuildData
} from '@/app/lib/sync/api-operations'
import { validateApiKeyWithTacticus } from '@tacticus/app-core/api-key-validation'

export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: true
  })
  if (securityResult) return securityResult

  const startTime = Date.now()
  let upperGuildCode = 'UNKNOWN'

  try {
    const { guild_code, api_key } = await request.json()

    if (!guild_code || !api_key) {
      throw Errors.fromResponse(400, {
        success: false,
        error: 'Missing required fields: guild_code and api_key are required'
      })
    }

    const supabase = serviceDb()
    upperGuildCode = validateGuildCode(guild_code)

    let decryptedApiKey = api_key
    if (api_key?.includes(':')) {
      try {
        decryptedApiKey = await decryptApiKey(api_key)
      } catch {
        decryptedApiKey = api_key
      }
    }

    const apiKeyValidation = await validateApiKeyWithTacticus(
      decryptedApiKey,
      false
    )
    if (!apiKeyValidation.isValid) {
      throw Errors.fromResponse(401, {
        error: apiKeyValidation.error || 'API key validation failed',
        suggestion: 'Please check your API key and try again'
      })
    }
    // Tacticus returns guildTag, not our guild_code; compare by guildId.
    if (!apiKeyValidation.guildInfo?.guildId) {
      logger.warn(
        {
          targetGuild: upperGuildCode,
          guildInfo: apiKeyValidation.guildInfo
        },
        '[INIT-SYNC] API key validated but guild identity could not be determined'
      )
      throw Errors.fromResponse(400, {
        error: 'Could not determine guild from API key',
        details:
          'The API key is valid but did not return guild information. Please try a different key.',
        recommendation:
          'Generate a new API key from Tacticus with Guild permissions enabled'
      })
    }

    const { data: syncTarget } = await supabase
      .from('guild_config')
      .select('guild_id')
      .eq('guild_code', upperGuildCode)
      .single()

    if (
      syncTarget?.guild_id &&
      apiKeyValidation.guildInfo.guildId !== syncTarget.guild_id
    ) {
      logger.warn(
        {
          targetGuild: upperGuildCode,
          targetGuildId: syncTarget.guild_id,
          apiKeyGuildId: apiKeyValidation.guildInfo.guildId,
          apiKeyGuildName: apiKeyValidation.guildInfo.guildName
        },
        '[INIT-SYNC] API key guild mismatch'
      )
      throw Errors.fromResponse(400, {
        error: 'API key belongs to a different guild',
        details: `This API key is for guild "${apiKeyValidation.guildInfo.guildName}", not ${upperGuildCode}`,
        recommendation:
          'Please use an API key from a player in the target guild'
      })
    }

    const patchedConfig = await autoPatchGuildConfig(
      supabase,
      upperGuildCode,
      decryptedApiKey
    )
    await detectCurrentGWSeasonFromGuildData(upperGuildCode, decryptedApiKey)

    const response = await fetchGuildRaidData(decryptedApiKey, upperGuildCode)

    if (!response.ok) {
      if (response.status === 401) throw new Error('Invalid API key')
      if (response.status === 403) throw new Error('API key not authorized')
      throw new Error(`API request failed: ${response.status}`)
    }

    const data = await response.json()
    const entries = extractEntries(data)
    // Fail closed rather than write onboarding data under a wrong season.
    let season = detectSeason(data, entries)
    if (season === null) {
      const { data: latestSeason } = await supabase.rpc('get_latest_season')
      season =
        latestSeason != null && /^\d+$/.test(String(latestSeason))
          ? String(latestSeason)
          : null
    }
    if (season === null) {
      logger.error(
        { guildCode: upperGuildCode },
        '[INIT-SYNC] Could not resolve current season; aborting to avoid mis-seasoned data'
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Could not resolve current season',
          guild_code: upperGuildCode
        },
        { status: 422 }
      )
    }

    if (entries.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No data to sync',
        guild_code: upperGuildCode,
        season
      })
    }

    const validEntries = filterValidEntries(entries)
    const bossMappings = await fetchBossMappings(supabase)
    const validationResult = await validateBossMappings(
      upperGuildCode,
      validEntries,
      bossMappings
    )

    const playerMappings = new Map<string, string>()
    let lokiMembers: LokiMember[] = []
    let tacticusMemberIds: string[] | null = null
    const rosterObservedAt = await beginGuildRosterObservation(supabase)

    if (patchedConfig.guild_id) {
      const result = await fetchGuildMembersViaTacticus(
        api_key,
        patchedConfig.guild_id,
        upperGuildCode
      )
      if (result.success) tacticusMemberIds = result.memberIds
    }

    // The shared LOKI account lives only in env; legacy row credentials are never paired with the secret.
    const lokiIdentity = resolveLokiIdentity(patchedConfig)
    const lokiUserId = lokiIdentity.userId
    const lokiSessionId = lokiIdentity.sessionId
    const lokiClientSecret = process.env.LOKI_SCRAPER_CLIENT_SECRET ?? null

    if (
      !patchedConfig.guild_id ||
      !lokiUserId ||
      (!lokiSessionId && !lokiIdentity.overrodeLegacyRow) ||
      !lokiClientSecret
    ) {
      throw new Error(
        'Missing required LOKI credentials in guild configuration'
      )
    }

    try {
      const lokiResult = await fetchGuildMembersViaLoki(
        upperGuildCode,
        patchedConfig.guild_id,
        lokiUserId,
        lokiSessionId,
        lokiClientSecret,
        supabase
      )
      lokiMembers = lokiResult.members

      if (lokiMembers.length > 0) {
        lokiMembers = handleDuplicateDisplayNames(lokiMembers, upperGuildCode)
        for (const member of lokiMembers) {
          playerMappings.set(member.userId, member.displayName)
          playerMappings.set(member.userId.toLowerCase(), member.displayName)
        }
        await savePlayerMappings(
          supabase,
          upperGuildCode,
          lokiMembers,
          tacticusMemberIds,
          {
            cluster_code: patchedConfig.cluster_code || null,
            cluster_id: patchedConfig.cluster_id || null
          },
          rosterObservedAt
        )
      }
    } catch (lokiError: unknown) {
      await updateSyncStatus(supabase, upperGuildCode, 'error', {
        errorMessage: getErrorMessage(lokiError)
      })
      throw Errors.fromResponse(500, {
        error: 'Failed to retrieve player names from game servers',
        details: getErrorMessage(lokiError)
      })
    }

    const existingMappings = await loadExistingPlayerMappings(
      supabase,
      upperGuildCode
    )
    for (const [key, value] of existingMappings) {
      if (!playerMappings.has(key)) playerMappings.set(key, value)
    }

    const heroTrackingResult = await trackUnitIds(
      supabase,
      validEntries,
      upperGuildCode
    )

    // Null encounterIndex entries are dropped (edge-path parity).
    const processedData: ProcessedRaidEntry[] = validEntries
      .map((entry) =>
        processRaidEntry(
          entry,
          upperGuildCode,
          season,
          playerMappings,
          bossMappings,
          patchedConfig.cluster_code || null,
          patchedConfig.cluster_id || null
        )
      )
      .filter((e): e is ProcessedRaidEntry => e !== null)

    const finalValidData = filterProcessedData(processedData)
    const mappingCoverage = await analyzeBossMappingCoverage(
      upperGuildCode,
      finalValidData
    )
    await updateBombTracking(
      supabase,
      validEntries,
      upperGuildCode,
      playerMappings
    )

    const { upserted, inserted, updated, errors } = await upsertDataBatches(
      supabase,
      upperGuildCode,
      finalValidData
    )

    let rankings = {
      guildRaid: null as number | null,
      guildWar: null as number | null
    }
    if (
      patchedConfig.guild_id &&
      lokiUserId &&
      patchedConfig.session_id &&
      lokiClientSecret
    ) {
      try {
        rankings = await fetchGuildRankings(
          upperGuildCode,
          patchedConfig.guild_id,
          lokiUserId,
          patchedConfig.session_id,
          lokiClientSecret,
          supabase
        )
      } catch (rankingsErr) {
        // Non-fatal, but logged so it is not mistaken for empty rankings.
        logger.warn(
          {
            guild_code: upperGuildCode,
            err: getErrorMessage(rankingsErr)
          },
          'Failed to fetch guild rankings; persisting NULL rankings'
        )
      }
    }

    const executionTime = Date.now() - startTime
    await updateGuildConfigAfterSync(supabase, upperGuildCode, rankings)
    await updateSyncStatus(supabase, upperGuildCode, 'completed', {
      recordsSynced: upserted,
      memberCount: lokiMembers.length
    })

    logger.info(
      {
        guild_code: upperGuildCode,
        upserted,
        player_count: lokiMembers.length,
        duration_ms: executionTime
      },
      'Sync completed'
    )

    return NextResponse.json(
      buildSyncSuccessResponse({
        guildCode: upperGuildCode,
        season,
        upserted,
        inserted,
        updated,
        errors,
        entries,
        validEntries,
        processedData,
        finalValidData,
        lokiMembers,
        playerMappings,
        heroTrackingResult,
        mappingCoverage,
        validationResult,
        rankings,
        executionTime
      })
    )
  } catch (error: unknown) {
    rethrowIfAppError(error)
    const executionTime = Date.now() - startTime
    const errorMessage = getErrorMessage(error)
    logger.error(
      { tag: 'INIT-SYNC', guild_code: upperGuildCode, error: errorMessage },
      'Sync failed'
    )

    if (upperGuildCode !== 'UNKNOWN') {
      try {
        await updateSyncStatus(serviceDb(), upperGuildCode, 'error', {
          errorMessage
        })
      } catch (statusErr) {
        logger.warn(
          {
            guild_code: upperGuildCode,
            err: getErrorMessage(statusErr),
            original_err: errorMessage
          },
          'Failed to persist error status after sync failure'
        )
      }
    }

    throw Errors.fromResponse(500, {
      error: errorMessage,
      details: 'Sync failed. You can retry with the same credentials.',
      executionTimeMs: executionTime
    })
  }
})

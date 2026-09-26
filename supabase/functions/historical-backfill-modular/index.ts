import { isCompleteHistoricalSync } from '../_shared/sync-completeness.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors-headers.ts'
import { jsonResponse } from '../_shared/response-helpers.ts'
import { createLogger } from '../_shared/logger.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { requireServiceRole } from '../_shared/auth-guard.ts'
import { normalizeGuildCode } from '../_shared/guild-code.ts'
import { readGuildSeasons } from '../_shared/guild-seasons.ts'
import { decryptApiKey } from '../_shared/sync-modules/decryption.ts'
import { callTacticusApi } from '../_shared/sync-modules/tacticus-api.ts'
import { EdgeFunctionTimeouts } from '../_shared/timeout-utils.ts'
import { planHistoricalSeasons } from './planning.ts'
import { parseLiveRaidSeason } from '../sync-modular-workflow/request-context.ts'

const CONFIG = {
  minRequiredSeasons: 5,
  maxRetainedSeasons: 20,
  lookbackSeasons: 20,
  tables: {
    guildConfig: 'guild_config',
    data: 'EOT_GR_data',
    backfillStatus: 'guild_historical_backfill_status'
  }
}

interface BackfillRequest {
  guild_code: string
  force_seasons?: number[]
  max_seasons?: number
}

interface SeasonResult {
  season: number
  success: boolean
  entries?: number
  error?: string
  executionTimeMs?: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  const authError = requireServiceRole(req)
  if (authError) return authError

  const startTime = Date.now()

  try {
    const parsedBody: unknown = await req.json()
    if (
      !parsedBody ||
      typeof parsedBody !== 'object' ||
      Array.isArray(parsedBody)
    ) {
      return jsonResponse(
        { success: false, error: 'Request body must be an object' },
        { status: 400 }
      )
    }
    const body = parsedBody as BackfillRequest
    const guildCode = normalizeGuildCode(body.guild_code)
    const forceSeasons = body.force_seasons
    if (forceSeasons !== undefined && !Array.isArray(forceSeasons)) {
      return jsonResponse(
        { success: false, error: 'Invalid forced seasons' },
        { status: 400 }
      )
    }
    if (
      forceSeasons &&
      (forceSeasons.length === 0 ||
        forceSeasons.length > CONFIG.maxRetainedSeasons ||
        forceSeasons.some((s) => !Number.isSafeInteger(s) || s <= 0) ||
        new Set(forceSeasons).size !== forceSeasons.length)
    ) {
      return jsonResponse(
        { success: false, error: 'Invalid forced seasons' },
        { status: 400 }
      )
    }
    const maxSeasons =
      body.max_seasons === undefined
        ? CONFIG.minRequiredSeasons
        : body.max_seasons

    if (
      !Number.isSafeInteger(maxSeasons) ||
      maxSeasons < 1 ||
      maxSeasons > CONFIG.maxRetainedSeasons
    ) {
      return jsonResponse(
        { success: false, error: 'Invalid max_seasons' },
        { status: 400 }
      )
    }

    if (!guildCode) {
      return jsonResponse(
        { success: false, error: 'guild_code is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const logger = createLogger({ module: 'historical-backfill', guildCode })

    logger.info('Starting modular historical backfill')

    const { data: guildConfig, error: configError } = await supabase
      .from(CONFIG.tables.guildConfig)
      .select('api_key_is_valid, api_key_encrypted, use_modular_sync')
      .eq('guild_code', guildCode)
      .single()

    if (configError) {
      return jsonResponse(
        { success: false, error: 'Guild not found' },
        { status: 404 }
      )
    }

    if (guildConfig.api_key_is_valid === false) {
      logger.warn('API key is invalid, skipping backfill')
      return jsonResponse(
        {
          success: false,
          error: 'API key is invalid',
          action: 'skipped'
        },
        { status: 400 }
      )
    }

    const getSeasons = () =>
      readGuildSeasons(() =>
        supabase.rpc('get_distinct_seasons_for_guild', {
          p_guild: guildCode
        })
      )
    const existingSeasons = await getSeasons()
    logger.info(`Existing seasons: ${existingSeasons.slice(0, 10).join(', ')}`)

    // MAX(Season) lags until the first battle; read the live API, not sync (nested guild lock + writes).
    const apiKey = await decryptApiKey(guildConfig.api_key_encrypted, logger)
    if (!apiKey) {
      return jsonResponse(
        { success: false, error: 'Could not decrypt guild API key' },
        { status: 503 }
      )
    }
    const liveSeasonResult = await callTacticusApi(
      '/guildRaid',
      apiKey,
      guildCode,
      new EdgeFunctionTimeouts('historical-backfill-modular'),
      { baseUrl: 'https://api.tacticusgame.com/api/v1', maxRetries: 1 },
      logger
    )
    const currentSeason = liveSeasonResult.success
      ? parseLiveRaidSeason(liveSeasonResult.data)
      : null
    if (currentSeason === null) {
      logger.error(
        `Cannot determine live current season for ${guildCode} from /guildRaid`
      )
      return jsonResponse(
        {
          success: false,
          error:
            'Could not determine current season from the live API; aborted backfill'
        },
        { status: 500 }
      )
    }

    let seasonsToFetch: number[] = []

    if (forceSeasons) {
      const minHistoricalSeason = Math.max(
        1,
        currentSeason - CONFIG.lookbackSeasons
      )
      if (
        forceSeasons.some(
          (season) => season < minHistoricalSeason || season >= currentSeason
        )
      ) {
        return jsonResponse(
          {
            success: false,
            error: 'Forced seasons are outside the historical window'
          },
          { status: 400 }
        )
      }
      seasonsToFetch = forceSeasons
      logger.info(`Forcing seasons: ${seasonsToFetch.join(', ')}`)
    } else {
      seasonsToFetch = planHistoricalSeasons({
        currentSeason,
        existingSeasons,
        maxSeasons,
        lookbackSeasons: CONFIG.lookbackSeasons
      })
    }

    if (seasonsToFetch.length === 0) {
      logger.info('No seasons to fetch')
      return jsonResponse(
        {
          success: true,
          action: 'skipped',
          reason: 'No missing seasons found',
          existingSeasons: existingSeasons.length
        },
        { status: 200 }
      )
    }

    logger.info(
      `Will fetch ${seasonsToFetch.length} seasons: ${seasonsToFetch.join(
        ', '
      )}`
    )

    const results: SeasonResult[] = []
    let totalInserted = 0
    let authError = false

    for (const season of seasonsToFetch) {
      if (authError) {
        results.push({
          season,
          success: false,
          error: 'Skipped due to auth error on previous season'
        })
        continue
      }

      const seasonStart = Date.now()
      logger.info(`Fetching season ${season}...`)

      try {
        const { data, error } = await supabase.functions.invoke(
          'sync-modular-workflow',
          {
            body: { guild_code: guildCode, season, skip_notifications: true }
          }
        )

        if (error) {
          logger.error(`Season ${season} invocation failed: ${error.message}`)
          results.push({
            season,
            success: false,
            error: error.message,
            executionTimeMs: Date.now() - seasonStart
          })
          continue
        }

        if (isCompleteHistoricalSync(data, season)) {
          const entries = data.stats?.finalValidEntries || 0
          totalInserted += entries
          results.push({
            season,
            success: true,
            entries,
            executionTimeMs: Date.now() - seasonStart
          })
          logger.info(
            `Season ${season}: ${entries} entries in ${
              Date.now() - seasonStart
            }ms`
          )
        } else {
          const errorMsg =
            data?.error || 'Historical season did not complete; retry required'
          if (
            errorMsg.includes('401') ||
            errorMsg.includes('403') ||
            data?.validation?.isValid === false
          ) {
            authError = true
            logger.error(`Auth error on season ${season}, stopping`)
          }
          results.push({
            season,
            success: false,
            error: errorMsg,
            executionTimeMs: Date.now() - seasonStart
          })
        }
      } catch (err) {
        logger.error(`Season ${season} exception: ${err}`)
        results.push({
          season,
          success: false,
          error: String(err),
          executionTimeMs: Date.now() - seasonStart
        })
      }
    }

    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const executionTime = Date.now() - startTime

    const finalSeasons = (await getSeasons()).length

    logger.info(
      `Backfill complete: ${successful} seasons added, ${failed} failed, ${totalInserted} total entries in ${executionTime}ms`
    )

    return jsonResponse(
      {
        success: failed === 0 && successful === seasonsToFetch.length,
        guild: guildCode,
        action: 'processed',
        stats: {
          seasonsRequested: seasonsToFetch.length,
          seasonsSuccessful: successful,
          seasonsFailed: failed,
          totalInserted,
          initialSeasonCount: existingSeasons.length,
          finalSeasonCount: finalSeasons,
          hasMinimumHistory: finalSeasons >= CONFIG.minRequiredSeasons,
          executionTimeMs: executionTime,
          authError
        },
        results
      },
      { status: 200 }
    )
  } catch (error) {
    // `logger` is out of scope here; using it would throw and hide the error.
    console.error('[historical-backfill] Backfill exception:', error)
    return jsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.ml.training-features')
import type { MlTrainingFeaturesApiResponse } from '@/app/lib/ml/api-types'
import {
  buildMlTrainingFeatureRow,
  parseMlPositiveIntParam,
  type MlTrainingRpcRow
} from '@/app/lib/ml/row-mappers'
import {
  authorizeMlRouteScope,
  callUntypedMlRpc
} from '@/app/lib/ml/route-helpers'

export const dynamic = 'force-dynamic'

const parseSeasonList = (value: string | null): string[] | null => {
  if (!value) return null
  const seasons = value
    .split(',')
    .map((season) => season.trim())
    .filter((season) => season.length > 0)
  return seasons.length > 0 ? seasons : null
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const requestStartedAt = Date.now()
  const searchParams = request.nextUrl.searchParams
  const guildCode = searchParams.get('guild')?.trim()
  const clusterCode = searchParams.get('cluster')?.trim() || null
  const seasonList = parseSeasonList(searchParams.get('seasons'))
  const minMetaAttacks = parseMlPositiveIntParam(
    searchParams.get('minMetaAttacks'),
    25
  )
  const minLoopSamples = parseMlPositiveIntParam(
    searchParams.get('minLoopSamples'),
    2
  )
  const limit = parseMlPositiveIntParam(searchParams.get('limit'), 5000)

  try {
    const { guildCode: scopedGuildCode, supabase } =
      await authorizeMlRouteScope(guildCode, clusterCode)
    const { data, error } = await callUntypedMlRpc(
      supabase,
      'get_ml_training_features',
      {
        p_guild_code: scopedGuildCode,
        p_seasons: seasonList ?? undefined,
        p_cluster_code: clusterCode ?? undefined,
        p_min_meta_attacks: minMetaAttacks,
        p_min_loop_samples: minLoopSamples,
        p_limit: limit
      }
    )

    if (error) {
      // RPC not deployed: return empty results.
      if (error.code === '42883') {
        logger.info(
          { guildCode },
          'ML training features RPC not available (function not deployed)'
        )
        const emptyResponse: MlTrainingFeaturesApiResponse = {
          success: true,
          source: 'rpc_v1',
          guildCode: scopedGuildCode,
          seasons: seasonList ?? [],
          rows: [],
          summary: {
            totalRows: 0,
            coldStartRows: 0,
            sparseRows: 0,
            sufficientRows: 0
          }
        }
        return NextResponse.json(emptyResponse, {
          headers: { 'Cache-Control': 'private, max-age=300' }
        })
      }

      logger.error(
        {
          guildCode,
          clusterCode,
          seasons: seasonList,
          code: error.code,
          message: error.message
        },
        'Failed to fetch ML training features'
      )
      throw Errors.database('Failed to fetch ML training features', {
        guildCode,
        clusterCode,
        seasons: seasonList,
        code: error.code,
        details: error.message
      })
    }

    const rows = ((data ?? []) as MlTrainingRpcRow[]).map(
      buildMlTrainingFeatureRow
    )
    const response: MlTrainingFeaturesApiResponse = {
      success: true,
      source: 'rpc_v1',
      guildCode: scopedGuildCode,
      seasons:
        seasonList ?? Array.from(new Set(rows.map((row) => row.season))).sort(),
      rows,
      summary: {
        totalRows: rows.length,
        coldStartRows: rows.filter((row) => row.dataDensity === 'cold_start')
          .length,
        sparseRows: rows.filter((row) => row.dataDensity === 'sparse').length,
        sufficientRows: rows.filter((row) => row.dataDensity === 'sufficient')
          .length
      }
    }

    const latencyMs = Date.now() - requestStartedAt
    logger.info(
      {
        guildCode,
        clusterCode,
        seasons: response.seasons,
        latencyMs,
        rowCount: rows.length,
        coldStartRows: response.summary.coldStartRows,
        sparseRows: response.summary.sparseRows,
        sufficientRows: response.summary.sufficientRows
      },
      'ML training features fetched'
    )

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
        'X-ML-Latency-Ms': String(latencyMs)
      }
    })
  } catch (error) {
    const latencyMs = Date.now() - requestStartedAt
    logger.error(
      {
        guildCode,
        clusterCode,
        seasons: seasonList,
        latencyMs,
        error: error instanceof Error ? error.message : 'unknown_error'
      },
      'ML training features request failed'
    )
    throw error
  }
})

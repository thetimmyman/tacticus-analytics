import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.ml.inference-inputs')
import type {
  MlInferenceApiResponse,
  MlInferenceInputRow
} from '@/app/lib/ml/api-types'
import {
  buildMlInferenceInputRow,
  parseMlPositiveIntParam,
  type MlInferenceRpcRow
} from '@/app/lib/ml/row-mappers'
import {
  authorizeMlRouteScope,
  callUntypedMlRpc
} from '@/app/lib/ml/route-helpers'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const requestStartedAt = Date.now()
  const searchParams = request.nextUrl.searchParams
  const guildCode = searchParams.get('guild')?.trim()
  const season = searchParams.get('season')?.trim() || null
  const clusterCode = searchParams.get('cluster')?.trim() || null
  const minMetaAttacks = parseMlPositiveIntParam(
    searchParams.get('minMetaAttacks'),
    25
  )
  const minLoopSamples = parseMlPositiveIntParam(
    searchParams.get('minLoopSamples'),
    2
  )

  try {
    const { guildCode: scopedGuildCode, supabase } =
      await authorizeMlRouteScope(guildCode, clusterCode)
    const { data, error } = await callUntypedMlRpc(
      supabase,
      'get_ml_inference_inputs',
      {
        p_guild_code: scopedGuildCode,
        p_season: season ?? undefined,
        p_cluster_code: clusterCode ?? undefined,
        p_min_meta_attacks: minMetaAttacks,
        p_min_loop_samples: minLoopSamples
      }
    )

    if (error) {
      // RPC not deployed: return empty results.
      if (error.code === '42883') {
        logger.info(
          { guildCode },
          'ML inference inputs RPC not available (function not deployed)'
        )
        const emptyResponse: MlInferenceApiResponse = {
          success: true,
          source: 'rpc_v1',
          guildCode: scopedGuildCode,
          season: season ?? '',
          rows: [],
          summary: {
            totalRows: 0,
            coldStartRows: 0,
            highConfidenceRows: 0,
            mediumConfidenceRows: 0,
            lowConfidenceRows: 0,
            decliningRows: 0,
            underBaselineRows: 0,
            coldStartReason: null
          }
        }
        return NextResponse.json(emptyResponse, {
          headers: { 'Cache-Control': 'private, max-age=300' }
        })
      }

      logger.error(
        {
          guildCode,
          season,
          clusterCode,
          code: error.code,
          message: error.message
        },
        'Failed to fetch ML inference inputs'
      )
      throw Errors.database('Failed to fetch ML inference inputs', {
        guildCode,
        season,
        clusterCode,
        code: error.code,
        details: error.message
      })
    }

    const rows = ((data ?? []) as MlInferenceRpcRow[])
      .map((row) => buildMlInferenceInputRow(row))
      .filter((row): row is MlInferenceInputRow => row !== null)

    const fallbackReason =
      ((data ?? []) as MlInferenceRpcRow[]).find(
        (row) => row.cold_start_reason && !row.boss_type
      )?.cold_start_reason ?? null

    const response: MlInferenceApiResponse = {
      success: true,
      source: 'rpc_v1',
      guildCode: scopedGuildCode,
      season: rows[0]?.season ?? season,
      rows,
      summary: {
        totalRows: rows.length,
        coldStartRows: rows.filter((row) => row.isColdStart).length,
        highConfidenceRows: rows.filter((row) => row.confidenceTier === 'high')
          .length,
        mediumConfidenceRows: rows.filter(
          (row) => row.confidenceTier === 'medium'
        ).length,
        lowConfidenceRows: rows.filter((row) => row.confidenceTier === 'low')
          .length,
        decliningRows: rows.filter((row) => (row.trendVsPrevPct ?? 0) <= -10)
          .length,
        underBaselineRows: rows.filter(
          (row) => (row.benchmarkDeltaPct ?? 0) <= -10
        ).length,
        coldStartReason: fallbackReason
      }
    }

    const latencyMs = Date.now() - requestStartedAt
    logger.info(
      {
        guildCode,
        season,
        clusterCode,
        latencyMs,
        rowCount: rows.length,
        coldStartRows: response.summary.coldStartRows,
        highConfidenceRows: response.summary.highConfidenceRows
      },
      'ML inference inputs fetched'
    )

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
        'X-ML-Latency-Ms': String(latencyMs)
      }
    })
  } catch (error) {
    const latencyMs = Date.now() - requestStartedAt
    logger.error(
      {
        guildCode,
        season,
        clusterCode,
        latencyMs,
        error: error instanceof Error ? error.message : 'unknown_error'
      },
      'ML inference inputs request failed'
    )
    throw error
  }
})

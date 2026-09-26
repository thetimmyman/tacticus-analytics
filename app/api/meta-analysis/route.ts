import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta-analysis')
import { recordCalculationMetric } from '@/app/lib/calculations/metrics'
import { AppError, Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { analyzeTeamCompositions } from '@/app/lib/services/meta-analysis'
import { buildGlobalMetaAnalysisPayload } from '@/app/lib/meta/meta-analysis-scope'
import {
  resolveMetaAnalysisAccessScope,
  withMetaAnalysisPrivateHeaders
} from './_scope'

/** Compositions are global, so the degraded scope is in the body and the UI never shows it as one guild's. */

const enableMetaRPC =
  process.env.NEXT_PUBLIC_ENABLE_META_ANALYSIS_RPC !== 'false'

async function handler(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams
  const rarity = searchParams.get('rarity')
  const set = searchParams.get('set')
  const season = searchParams.get('season')
  const guildFilter = searchParams.get('guildFilter')
  const minBattles = searchParams.get('minBattles')
  const encounterId = searchParams.get('encounterId')
  const limit = searchParams.get('limit')

  if (!rarity || !set || !season) {
    throw Errors.validation('Missing required parameters: rarity, set, season')
  }

  const start = Date.now()
  const filterCount =
    Number(Boolean(guildFilter)) +
    Number(Boolean(encounterId)) +
    Number(Boolean(minBattles))

  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.unauthorized('Authentication required')
    )

    await resolveMetaAnalysisAccessScope(supabase, user.id, guildFilter)

    if (!enableMetaRPC) {
      recordCalculationMetric({
        id: 'meta_analysis_compositions',
        strategy: 'fallback-disabled',
        durationMs: Date.now() - start,
        success: true,
        source: 'api',
        filterCount
      })
      return NextResponse.json(
        buildGlobalMetaAnalysisPayload([], guildFilter),
        {
          headers: {
            'x-meta-source': 'fallback-disabled'
          }
        }
      )
    }

    const toInt = (value: string | null) =>
      value !== null ? parseInt(value, 10) : undefined

    const mapped = await analyzeTeamCompositions(
      rarity,
      parseInt(set, 10),
      season,
      toInt(minBattles) ?? null,
      toInt(encounterId) ?? null,
      toInt(limit) ?? null,
      supabase
    )

    recordCalculationMetric({
      id: 'meta_analysis_compositions',
      strategy: 'meta-atlas-global',
      durationMs: Date.now() - start,
      success: true,
      source: 'api',
      filterCount
    })

    const responseHeaders: Record<string, string> = {
      'x-meta-source': 'meta-atlas-rpc',
      'x-meta-scope': 'global'
    }
    if (guildFilter) {
      responseHeaders['x-meta-guild-filter-ignored'] = 'true'
    }

    return NextResponse.json(
      buildGlobalMetaAnalysisPayload(mapped ?? [], guildFilter),
      { headers: responseHeaders }
    )
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error(
      { err: err },
      'Meta analysis RPC failed, returning fallback-error payload:'
    )
    recordCalculationMetric({
      id: 'meta_analysis_compositions',
      strategy: 'meta-atlas-global',
      durationMs: Date.now() - start,
      success: false,
      source: 'api',
      errorName: err instanceof Error ? err.name : 'unknown'
    })

    return NextResponse.json(buildGlobalMetaAnalysisPayload([], guildFilter), {
      status: 200,
      headers: {
        'x-meta-source': 'fallback-error'
      }
    })
  }
}

export const GET = withMetaAnalysisPrivateHeaders(withErrorHandler(handler))

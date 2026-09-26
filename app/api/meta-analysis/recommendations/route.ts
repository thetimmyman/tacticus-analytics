import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta-analysis.recommendations')
import type { RecommendedTeam } from '@tacticus/app-core/meta-analysis.types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  buildCompositionFromMetaAtlasRow,
  compareMetaAtlasRowsByStrength,
  fetchMetaAtlasSeasonRows,
  type MetaAtlasAuthenticatedRow
} from '@/app/lib/meta/meta-atlas-compositions'
import { buildGlobalMetaAnalysisPayload } from '@/app/lib/meta/meta-analysis-scope'
import { parseMetaAnalysisRarities } from '../_shared'
import {
  resolveMetaAnalysisAccessScope,
  withMetaAnalysisPrivateHeaders
} from '../_scope'

/** Best team per (rarity, set, encounter) from the global aggregate; guildFilter cannot scope it. */

function pickBestRowPerCell(
  rows: MetaAtlasAuthenticatedRow[],
  rarities: string[]
): MetaAtlasAuthenticatedRow[] {
  const rarityAllowList = new Set(rarities)
  const bestByCell = new Map<string, MetaAtlasAuthenticatedRow>()

  for (const row of rows) {
    const rarity = row.rarity ?? ''
    const set = row.set_num ?? -1
    const encounter = row.encounter_index ?? 0
    if (!rarityAllowList.has(rarity)) continue
    if (set < 0 || set > 4) continue
    if (encounter < 0 || encounter > 2) continue

    const cellKey = `${rarity}|${set}|${encounter}`
    const incumbent = bestByCell.get(cellKey)
    if (!incumbent || compareMetaAtlasRowsByStrength(row, incumbent) < 0) {
      bestByCell.set(cellKey, row)
    }
  }

  return [...bestByCell.values()]
}

const handler = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams
  const season = searchParams.get('season')
  const guildFilter = searchParams.get('guildFilter')
  const rarityParam = searchParams.get('rarity')

  if (!season) {
    throw Errors.fromResponse(400, {
      error: 'Missing required parameter: season'
    })
  }

  const rarities = parseMetaAnalysisRarities(rarityParam, { trim: false })

  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.unauthorized('Authentication required')
    )
    // guildFilter no longer narrows the data, but the gate keeps non-members out.
    await resolveMetaAnalysisAccessScope(supabase, user.id, guildFilter)

    const responseHeaders: Record<string, string> = {
      'x-meta-source': 'meta-atlas-rpc',
      'x-meta-scope': 'global'
    }
    if (guildFilter) {
      responseHeaders['x-meta-guild-filter-ignored'] = 'true'
    }

    try {
      const seasonRows = await fetchMetaAtlasSeasonRows(supabase, season)
      const bestRows = pickBestRowPerCell(seasonRows, rarities)

      const recommendations: RecommendedTeam[] = bestRows.map((row) => {
        const rarity = row.rarity ?? ''
        const set = row.set_num ?? 0
        const mapped = buildCompositionFromMetaAtlasRow(
          row,
          { rarity, set, season },
          {
            minDamageMode: 'avg',
            standardDeviationMode: 'zero',
            coefficientFallback: 0,
            bossNameFallback: 'Boss'
          }
        )
        const { bossName, encounterId: _encounterId, ...composition } = mapped

        const levelPrefix = rarity.charAt(0).toUpperCase()
        return {
          rarity,
          set,
          levelString: `${levelPrefix}${set + 1}`,
          bossName,
          composition,
          rank: 1
        }
      })

      return NextResponse.json(
        buildGlobalMetaAnalysisPayload(recommendations, guildFilter),
        { headers: responseHeaders }
      )
    } catch (rpcError) {
      logger.error({ err: rpcError }, 'Recommendations RPC failed:')
      return NextResponse.json(
        buildGlobalMetaAnalysisPayload<RecommendedTeam>([], guildFilter),
        {
          headers: { 'x-meta-source': 'fallback-error' }
        }
      )
    }
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error in recommendations API:')
    return NextResponse.json(
      buildGlobalMetaAnalysisPayload<RecommendedTeam>([], guildFilter),
      {
        headers: { 'x-meta-source': 'fallback-error' }
      }
    )
  }
}

export const GET = withMetaAnalysisPrivateHeaders(withErrorHandler(handler))

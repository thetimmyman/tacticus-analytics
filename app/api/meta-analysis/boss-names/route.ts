import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta-analysis.boss-names')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { CLUSTER_LOOKUP_SELECT } from '@/app/lib/guild-config-selects'
import {
  filterToLoopWindow,
  levelCodeFrom,
  toLoopObservations
} from '@/app/lib/boss-assignments/loop-window'
import {
  buildMetaBossNameMap,
  parseMetaAnalysisRarities,
  type MetaAnalysisBossRecord
} from '../_shared'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams
  const season = searchParams.get('season')
  const rarityParam = searchParams.get('rarity') ?? searchParams.get('rarities')

  const rarities = parseMetaAnalysisRarities(rarityParam)

  if (!season) {
    throw Errors.fromResponse(400, { error: 'Season is required' })
  }

  const supabase = await db()

  try {
    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    const { data: profile, error: profileError } = await supabase
      .from('player_with_cluster')
      .select(CLUSTER_LOOKUP_SELECT)
      .eq('user_id', user.id)
      .single()

    if (profileError || !profile) {
      throw Errors.fromResponse(404, { error: 'User profile not found' })
    }

    if (!profile.cluster_code && !profile.guild_code) {
      throw Errors.fromResponse(403, {
        error: 'User has no guild association. Access denied.'
      })
    }

    let query = supabase
      .from('EOT_GR_data')
      .select('rarity, set, Name, encounterId, loopIndex, Guild')
      .eq('Season', season)
      .eq('damageType', 'Battle')
      .in('rarity', rarities)
      .not('Name', 'is', null)
      .order('startedOn', { ascending: false })

    if (profile.cluster_code) {
      // Never include null cluster_code: it may hold other clusters' data.
      query = query.eq('cluster_code', profile.cluster_code)
    } else if (profile.guild_code) {
      query = query.eq('Guild', profile.guild_code)
    }

    const { data: bosses, error } = await query

    if (error) {
      logger.error({ err: error }, 'Error fetching boss names:')
      throw Errors.fromResponse(500, { error: 'Failed to fetch boss names' })
    }

    // Single-pass stages go in a header so the body stays a flat `${rarity}-${set}` map.
    const bossRecords = (bosses ?? []) as MetaAnalysisBossRecord[]
    const levelOf = (row: MetaAnalysisBossRecord) =>
      levelCodeFrom(row.rarity, row.set) ?? ''
    const keptLevels = new Set(
      filterToLoopWindow(bossRecords, levelOf, toLoopObservations(bossRecords))
        .map(levelOf)
        .filter(Boolean)
    )
    const singlePassStages = Array.from(
      new Set(bossRecords.map(levelOf).filter(Boolean))
    ).filter((code) => !keptLevels.has(code))

    return NextResponse.json(buildMetaBossNameMap(bossRecords), {
      headers: { 'X-Single-Pass-Stages': singlePassStages.join(',') }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error in boss-names endpoint:')
    throw Errors.fromResponse(500, { error: 'Failed to fetch boss names' })
  }
})

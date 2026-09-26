import { NextRequest, NextResponse } from 'next/server'
import { analyzeTeamCompositions } from '@/app/lib/services/meta-analysis'
import { db } from '@/app/lib/db'
import { getCachedClusterContext } from '@tacticus/app-core/cluster-cache'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta-analysis.batch')
import {
  getRarityPrefix,
  normalizeRarity
} from '@tacticus/app-core/rarity-utils'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  annotateMixedMetaAnalysisScope,
  resolveFilteredMetaAnalysisScope
} from '@/app/lib/meta/meta-analysis-scope'
import type { Database } from '@tacticus/app-core/database.generated'
import {
  buildMetaAnalysisBossLevels,
  buildMetaBossNameKey,
  parseMetaAnalysisRarities,
  type MetaAnalysisBossRecord
} from '../_shared'
import { withMetaAnalysisPrivateHeaders } from '../_scope'

type RecommendedTeamRow =
  Database['public']['Functions']['get_recommended_teams_for_season']['Returns'][number]

async function handler(request: NextRequest): Promise<Response> {
  const searchParams = request.nextUrl.searchParams
  const season = searchParams.get('season')
  const guildFilter = searchParams.get('guildFilter')
  const minBattles = searchParams.get('minBattles')
  const rarityParam = searchParams.get('rarity') ?? searchParams.get('rarities')

  const rarities = parseMetaAnalysisRarities(rarityParam)

  if (!season) {
    throw Errors.fromResponse(400, {
      error: 'Missing required parameter: season'
    })
  }

  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    let clusterCode: string | null = null
    let userGuildCode: string | null = null

    const clusterContext = await getCachedClusterContext(
      user.id,
      async (userId) => {
        const { data: profile, error } = await supabase
          .from('player_with_cluster')
          .select('cluster_code, guild_code, role')
          .eq('user_id', userId)
          .maybeSingle()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profileResult = profile as any

        if (error) {
          logger.warn(
            { error: error },
            '[Meta Analysis API] Failed to read cluster context; continuing without cache'
          )
          return null
        }

        return profileResult ?? null
      }
    )

    if (clusterContext) {
      clusterCode = clusterContext.clusterCode
      userGuildCode = clusterContext.guildCode
    }

    // Cluster members see cluster data, guild-only users their guild; neither is denied.
    if (!clusterCode && !userGuildCode) {
      throw Errors.fromResponse(403, {
        error: 'User has no guild association. Access denied.'
      })
    }

    let bossQuery = supabase
      .from('EOT_GR_data')
      .select('rarity, set, Name, encounterId')
      .eq('Season', season)
      .in('rarity', rarities)
      .not('Name', 'is', null)
      .order('startedOn', { ascending: false })
      .limit(100)

    if (clusterCode) {
      // Never include null cluster_code: it may hold other clusters' data.
      bossQuery = bossQuery.eq('cluster_code', clusterCode)
    } else if (userGuildCode) {
      bossQuery = bossQuery.eq('Guild', userGuildCode)
    }

    const { data: bossNamesData } = await bossQuery
    const { bossLevels, bossNames } = buildMetaAnalysisBossLevels(
      bossNamesData as MetaAnalysisBossRecord[] | null
    )

    const analysisPromises = bossLevels.map(async (boss) => {
      try {
        // The GLOBAL Meta Atlas aggregate, not guild/cluster scoped.
        const compositions = await analyzeTeamCompositions(
          boss.rarity,
          boss.set,
          season,
          minBattles ? parseInt(minBattles) : 2,
          boss.encounterId,
          null,
          supabase
        )

        return {
          rarity: boss.rarity,
          set: boss.set,
          levelString: (() => {
            const normalizedRarity = normalizeRarity(boss.rarity)
            const prefix = normalizedRarity
              ? getRarityPrefix(normalizedRarity)
              : 'L'
            return `${prefix}${boss.set + 1}`
          })(),
          encounterId: boss.encounterId,
          bossType: boss.bossType,
          bossName:
            bossNames[
              buildMetaBossNameKey(boss.rarity, boss.set, boss.encounterId)
            ] || 'Boss',
          compositions,
          loading: false,
          error: null
        }
      } catch (error: unknown) {
        logger.error(
          { err: error },
          `[Meta Analysis API] Error analyzing ${boss.rarity} ${boss.set + 1}:`
        )
        const errorMessage = getErrorMessage(error)
        return {
          rarity: boss.rarity,
          set: boss.set,
          levelString: (() => {
            const normalizedRarity = normalizeRarity(boss.rarity)
            const prefix = normalizedRarity
              ? getRarityPrefix(normalizedRarity)
              : 'L'
            return `${prefix}${boss.set + 1}`
          })(),
          encounterId: boss.encounterId,
          bossType: boss.bossType,
          bossName: 'Boss',
          compositions: [],
          loading: false,
          error: errorMessage || 'Analysis failed'
        }
      }
    })

    const allAnalyses = await Promise.all(analysisPromises)

    // Unlike compositions, this RPC honours p_guild_filter / p_cluster_code.
    const recommendedTeamsGuildFilter = guildFilter || userGuildCode || null
    const recommendedTeamsScope = resolveFilteredMetaAnalysisScope(
      recommendedTeamsGuildFilter,
      clusterCode
    )

    let recommendedTeams: RecommendedTeamRow[] = []
    try {
      const { data: teams, error: teamsFetchError } = await supabase.rpc(
        'get_recommended_teams_for_season',
        {
          p_season: season,
          p_guild_filter: recommendedTeamsGuildFilter ?? undefined,
          p_cluster_code: clusterCode ?? undefined
        }
      )

      if (!teamsFetchError) {
        recommendedTeams = teams || []
      } else {
        logger.warn(
          { teamsFetchError: teamsFetchError },
          '[Meta Analysis API] get_recommended_teams_for_season returned an error'
        )
      }
    } catch (recommendedTeamsError) {
      logger.warn(
        { recommendedTeamsError: recommendedTeamsError },
        '[Meta Analysis API] Failed to fetch recommended teams'
      )
    }

    // Sections have different scopes; the body states each so consumers do not assume one.
    const scopeAnnotation = annotateMixedMetaAnalysisScope(
      {
        compositions: 'global',
        recommendedTeams: recommendedTeamsScope
      },
      guildFilter
    )

    return NextResponse.json({
      analyses: allAnalyses,
      recommendedTeams: recommendedTeams,
      bossNames,
      season,
      clusterCode,
      ...scopeAnnotation,
      timestamp: Date.now()
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    logger.error({ err: error }, '[Meta Analysis API] Top-level error:')

    const errorMessage = getErrorMessage(error) || 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    throw Errors.fromResponse(500, {
      error: 'Failed to analyze team compositions',
      details: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      timestamp: Date.now()
    })
  }
}

export const GET = withMetaAnalysisPrivateHeaders(withErrorHandler(handler))

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const withMessage = error as {
      message?: unknown
      error?: { message?: unknown }
    }
    if (typeof withMessage.message === 'string') {
      return withMessage.message
    }

    if (withMessage.error && typeof withMessage.error.message === 'string') {
      return withMessage.error.message
    }
  }

  return 'Unknown error'
}

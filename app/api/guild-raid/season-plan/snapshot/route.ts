import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-raid.season-plan.snapshot')
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import { buildPlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import { resolvePlanningRotation } from '@/app/lib/boss-assignments/season-planner/planning-rotation'
import {
  getSeasonConfigForSeasonNumber,
  matchSeasonConfig,
  SEASON_CONFIGS
} from '@/app/lib/loki/season-configs'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  requireSeasonPlanOfficerContext,
  resolveSeasonPlanSeason
} from '../_shared'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const { supabase, profile } = await requireSeasonPlanOfficerContext({
      requireFeatureAccess: true
    })

    const searchParams = request.nextUrl.searchParams
    const hasExplicitSeason = searchParams.has('season')
    const hasExplicitSnapshotAt = searchParams.has('snapshot_at')
    const season = await resolveSeasonPlanSeason(searchParams.get('season'))
    const snapshotAt =
      searchParams.get('snapshot_at') || new Date().toISOString()
    const configIdParam = searchParams.get('config_id')

    const [bossHpData, rotationSnapshot] = await Promise.all([
      getAllBossHp(profile.guild_code),
      ensureRotationSnapshot()
    ])
    const seasonNumber = Number.parseInt(season, 10)

    const { data: distinctBosses } = await supabase
      .from('EOT_GR_data')
      .select('Name')
      .eq('Guild', profile.guild_code)
      .eq('Season', season)
      .eq('encounterId', 0)
      .in('rarity', ['Legendary', 'Mythic'])
      .not('Name', 'is', null)
      .order('startedOn', { ascending: false })

    const observedBossNames = Array.from(
      new Set(
        (distinctBosses ?? [])
          .map((r) => r.Name)
          .filter((n): n is string => !!n)
      )
    )

    const { config: detectedConfig, matches: detectedMatches } =
      matchSeasonConfig(observedBossNames)
    const detectedConfigId = detectedConfig.id
    const detectedConfigIndex = SEASON_CONFIGS.findIndex(
      (c) => c.id === detectedConfigId
    )

    const { rotation: planningRotation, seasonId } = resolvePlanningRotation({
      configId: configIdParam || null,
      seasonConfig: getSeasonConfigForSeasonNumber(seasonNumber),
      liveRotation: rotationSnapshot
    })

    // Its captured ladder, never a cross-season fallback.
    const progressionConfig = await getActiveProgressionConfig(
      profile.guild_code,
      seasonNumber
    )

    const snapshot = await buildPlanFromNowSnapshot({
      supabase,
      guildCode: profile.guild_code,
      season,
      seasonId,
      snapshotAt,
      bossHpData,
      rotationSnapshot: planningRotation,
      progressionConfig,
      preferAsOfStatus:
        hasExplicitSeason || hasExplicitSnapshotAt || Boolean(configIdParam)
    })

    const { data: roster, error: rosterError } = await guildRosterQuery(
      supabase,
      profile.guild_code,
      'player_id, display_name'
    ).order('display_name')

    if (rosterError) {
      logger.warn(
        { error: rosterError.message },
        'Failed to load guild roster for season planner snapshot'
      )
    }

    return NextResponse.json({
      snapshot,
      roster: roster ?? [],
      detectedConfigId,
      detectedConfigIndex,
      detectedMatches,
      observedBossCount: observedBossNames.length
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error in season planner snapshot API:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

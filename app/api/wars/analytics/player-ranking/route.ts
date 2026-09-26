import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { isFeatureEnabled } from '@/app/lib/utils/feature-flags'
import {
  BEPHUS_FORMULA_VERSION,
  buildPlayerRanking,
  type RankingBattleRow,
  type WarExclusion
} from '@/app/lib/war/bephus-ranking'
import {
  crossCheckZoneEvents,
  type ZoneEventRow
} from '@/app/lib/war/zone-chronology'
import { captureScoreCap } from '@/app/(dashboard)/wars/[warId]/board/board-utils'

const logger = createComponentLogger('api.wars.analytics.player-ranking')

const MAX_WAR_COUNT = 50
const DEFAULT_WAR_COUNT = 6

/**
 * War leaderboard (formula bephus-v1). The guild comes from the caller's active
 * membership, never the body; serviceDb is reached only after that check.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isFeatureEnabled('warPlayerRanking')) {
    throw Errors.fromResponse(404, { error: 'Not found' })
  }

  const { profile } = await requireActiveMembershipForApi()

  try {
    const guildCode = profile.guild_code
    if (!guildCode) {
      throw Errors.fromResponse(400, { error: 'No guild associated with user' })
    }

    // Parse errors, null, arrays and non-objects all become {}.
    const parsed = await request.json().catch(() => null)
    const body: Record<string, unknown> =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    const formulaVersion = body['formulaVersion']
    const warCountRaw = body['warCount']
    if (formulaVersion != null && formulaVersion !== BEPHUS_FORMULA_VERSION) {
      throw Errors.fromResponse(400, {
        error: `Unknown formulaVersion; supported: ${BEPHUS_FORMULA_VERSION}`
      })
    }
    const warCount = Math.min(
      MAX_WAR_COUNT,
      Math.max(
        1,
        typeof warCountRaw === 'number' && Number.isFinite(warCountRaw)
          ? Math.floor(warCountRaw)
          : DEFAULT_WAR_COUNT
      )
    )

    const supabase = serviceDb()

    const { data: warRows, error: warError } = await supabase
      .from('guild_war_matches')
      .select('war_id, opponent_guild_name, war_season, war_end_date')
      .eq('guild_code', guildCode)
      .eq('war_status', 'completed')
      .order('war_end_date', { ascending: false })
      .limit(warCount)

    if (warError) {
      logger.error({ error: warError, guildCode }, 'Failed to fetch wars')
      throw Errors.fromResponse(500, { error: 'Failed to fetch wars' })
    }

    const wars = warRows ?? []
    const warIds = wars
      .map((w) => w.war_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (warIds.length === 0) {
      return NextResponse.json({
        formulaVersion: BEPHUS_FORMULA_VERSION,
        wars: [],
        players: [],
        excludedWars: [],
        excludedBattles: {
          'no-result': 0,
          'no-before-hp': 0,
          'no-defenders-alive': 0
        },
        scoredBattles: 0,
        zoneEventPopulation: 0
      })
    }

    // PostgREST silently truncates at max rows, which would make the cross-check exclude
    // healthy wars as incomplete; the ceiling fails loudly on pathological data.
    const PAGE_SIZE = 1000
    const MAX_BATTLE_ROWS = 100_000
    const battles: RankingBattleRow[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      if (offset >= MAX_BATTLE_ROWS) {
        logger.error(
          { guildCode, offset },
          'battle pagination exceeded MAX_BATTLE_ROWS ceiling'
        )
        throw Errors.fromResponse(500, { error: 'Battle set too large' })
      }
      const page = await supabase
        .from('guild_war_battles')
        .select(
          'war_id, zone_id, player_id:attacker_player_id, player_name:attacker_player_name, is_guild_member, defender_player_id, score_earned, attempt_result, attempt_end_time, buffs, attacker_units_json, defender_units_json, attacker_units_lost'
        )
        .eq('guild_code', guildCode)
        .in('war_id', warIds)
        .eq('attempt_status', 'completed')
        .order('attempt_end_time', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (page.error) {
        logger.error(
          { error: page.error, guildCode },
          'Failed to fetch battles'
        )
        throw Errors.fromResponse(500, { error: 'Failed to fetch battles' })
      }
      const rows = (page.data ?? []) as unknown as RankingBattleRow[]
      battles.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }

    const eventsRes = await supabase
      .from('guild_war_zone_events')
      .select('war_id, zone_id, event_type')
      .eq('guild_code', guildCode)
      .in('war_id', warIds)

    if (eventsRes.error) {
      logger.error(
        { error: eventsRes.error, guildCode },
        'Failed to fetch zone events'
      )
      throw Errors.fromResponse(500, { error: 'Failed to fetch zone events' })
    }

    const events = (eventsRes.data ?? []) as unknown as ZoneEventRow[]

    // Always log the examined population: a clean report over 0 rows checked nothing.
    const crossCheck = crossCheckZoneEvents(battles, events)
    logger.info(
      {
        guildCode,
        wars: warIds.length,
        battles: battles.length,
        zoneEventPopulation: crossCheck.eventPopulation,
        crossCheckSkipped: crossCheck.skipped,
        checkedEvents: crossCheck.checkedEvents,
        matchedEvents: crossCheck.matchedEvents,
        incompleteWars: crossCheck.incompleteWarIds
      },
      'player-ranking zone-events cross-check'
    )
    const excludedWars: WarExclusion[] = crossCheck.incompleteWarIds.map(
      (warId) => ({
        warId,
        reason:
          'zone-events-mismatch: a destroyed zone has no detected capture — battle records for this war are incomplete'
      })
    )

    const capByWarId = new Map<string, number>()
    for (const warId of warIds) {
      const scores = battles
        .filter(
          (b) =>
            b.war_id === warId &&
            b.is_guild_member === true &&
            typeof b.score_earned === 'number' &&
            b.score_earned > 0
        )
        .map((b) => b.score_earned as number)
      capByWarId.set(warId, captureScoreCap(scores))
    }

    const ranking = buildPlayerRanking(battles, excludedWars, capByWarId)

    return NextResponse.json({
      ...ranking,
      wars: wars.filter((w) => !crossCheck.incompleteWarIds.includes(w.war_id)),
      zoneEventPopulation: crossCheck.eventPopulation
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'player-ranking API error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

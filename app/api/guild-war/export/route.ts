import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireRoleForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-war.export')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { profile } = await requireRoleForApi('officer')

  try {
    if (!profile.guild_code) {
      throw Errors.fromResponse(400, { error: 'No guild associated with user' })
    }

    const guildCode = profile.guild_code
    const supabase = await db()
    const { searchParams } = new URL(request.url)
    const warIds = searchParams.get('war_ids')?.split(',').filter(Boolean)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

    let matchQuery = supabase
      .from('guild_war_matches')
      .select('*')
      .eq('guild_code', guildCode)
      .order('war_start_date', { ascending: false })

    if (warIds && warIds.length > 0) {
      matchQuery = matchQuery.in('war_id', warIds)
    } else {
      matchQuery = matchQuery.limit(limit)
    }

    const { data: matches, error: matchError } = await matchQuery
    if (matchError) {
      logger.error({ error: matchError }, 'Error fetching matches for export')
      throw Errors.fromResponse(500, { error: 'Failed to fetch war matches' })
    }

    if (!matches || matches.length === 0) {
      return NextResponse.json({ wars: [] })
    }

    const matchWarIds = matches.map((m) => m.war_id)

    const [zonesResult, participationResult, attemptsResult] =
      await Promise.all([
        supabase
          .from('guild_war_zones')
          .select('*')
          .eq('guild_code', guildCode)
          .in('war_id', matchWarIds)
          .order('zone_number'),
        supabase
          .from('guild_war_participation')
          .select('*')
          .eq('guild_code', guildCode)
          .in('war_id', matchWarIds),
        supabase
          .from('guild_war_player_attempts')
          .select('*')
          .eq('guild_code', guildCode)
          .in('war_id', matchWarIds)
          .order('attempt_number')
      ])

    if (zonesResult.error) {
      logger.error(
        { error: zonesResult.error },
        'Error fetching zones for export'
      )
    }
    if (participationResult.error) {
      logger.error(
        { error: participationResult.error },
        'Error fetching participation for export'
      )
    }
    if (attemptsResult.error) {
      logger.error(
        { error: attemptsResult.error },
        'Error fetching attempts for export'
      )
    }

    const zones = zonesResult.data ?? []
    const participation = participationResult.data ?? []
    const attempts = attemptsResult.data ?? []

    const zonesByWar = new Map<string, typeof zones>()
    for (const zone of zones) {
      const list = zonesByWar.get(zone.war_id) ?? []
      list.push(zone)
      zonesByWar.set(zone.war_id, list)
    }

    const attemptsByZone = new Map<string, typeof attempts>()
    for (const attempt of attempts) {
      const list = attemptsByZone.get(attempt.zone_id) ?? []
      list.push(attempt)
      attemptsByZone.set(attempt.zone_id, list)
    }

    const participationByWar = new Map<string, typeof participation>()
    for (const part of participation) {
      const list = participationByWar.get(part.war_id) ?? []
      list.push(part)
      participationByWar.set(part.war_id, list)
    }

    const wars = matches.map((match) => {
      const warZones = zonesByWar.get(match.war_id) ?? []
      const warParticipation = participationByWar.get(match.war_id) ?? []

      return {
        war_id: match.war_id,
        opponent_guild_name: match.opponent_guild_name,
        opponent_guild_code: match.opponent_guild_code ?? undefined,
        war_status: match.war_status,
        war_result: match.war_result ?? undefined,
        guild_score: match.guild_score ?? undefined,
        opponent_score: match.opponent_score ?? undefined,
        war_start_date: match.war_start_date ?? undefined,
        war_end_date: match.war_end_date ?? undefined,
        war_season: match.war_season ?? undefined,
        battlefield_level: match.battlefield_level ?? undefined,
        zones: warZones.map((zone) => ({
          zone_number: zone.zone_number,
          zone_type: zone.zone_type,
          zone_status: zone.zone_status,
          zone_name: zone.zone_name ?? undefined,
          assigned_players: zone.assigned_players ?? undefined,
          attempts: (attemptsByZone.get(zone.id) ?? []).map((attempt) => ({
            // Real identity so re-importing upserts instead of duplicating.
            event_id: attempt.event_id ?? undefined,
            player_id: attempt.player_id,
            player_name: attempt.player_name,
            attempt_number: attempt.attempt_number,
            attempt_status: attempt.attempt_status,
            attempt_result: attempt.attempt_result ?? undefined,
            damage_dealt: attempt.damage_dealt ?? undefined,
            score_earned: attempt.score_earned ?? undefined,
            units_used: attempt.attacker_units_json ?? undefined,
            attempt_start_time: attempt.attempt_start_time ?? undefined,
            attempt_end_time: attempt.attempt_end_time ?? undefined
          }))
        })),
        participation: warParticipation.map((part) => ({
          user_id: part.user_id,
          display_name: part.display_name ?? undefined,
          role: part.role ?? undefined,
          opted_in: part.opted_in ?? undefined,
          attempts_used: part.attempts_used ?? undefined,
          attempts_remaining: part.attempts_remaining ?? undefined,
          score: part.score ?? undefined,
          exhausted_units: part.exhausted_units ?? undefined
        }))
      }
    })

    return NextResponse.json({ wars })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Guild war export error')
    throw Errors.fromResponse(500, { error: 'Failed to export war data' })
  }
})

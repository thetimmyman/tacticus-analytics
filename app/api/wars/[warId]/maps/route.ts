import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireWarAccess } from '../_shared'
import type { MapStats } from '@/app/(dashboard)/wars/_types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { isWarZoneCaptured } from '@/app/lib/war/war-zone-captured'
import type { Json } from '@tacticus/app-core/database.generated'

export const GET = withErrorHandler(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ warId: string }> }
  ) => {
    const { warId } = await params

    const supabase = await db()

    const { guildCode } = await requireWarAccess(supabase, warId, {
      shape: 'membership-first'
    })

    // Names derive from zone_type; legacy zone_name is never selected.
    const { data: zones } = await supabase
      .from('guild_war_zones')
      .select('id, zone_type')
      .eq('war_id', warId)
      .eq('guild_code', guildCode)

    if (!zones || zones.length === 0) {
      return NextResponse.json([])
    }

    const { data: battles } = await supabase
      .from('guild_war_battles')
      .select(
        'zone_id, score_earned, attempt_result, is_guild_member, defender_units_json'
      )
      .eq('war_id', warId)
      .eq('guild_code', guildCode)

    interface BattleRow {
      zone_id: string | null
      score_earned: number | null
      attempt_result: string | null
      is_guild_member: boolean | null
      defender_units_json: Json | null
    }

    // Keyed by zone type, not row id: a board can hold two rows of one type.
    const zoneTypeById = new Map<string, string>()
    const zoneStatsMap = new Map<
      string,
      {
        attacks: number
        wins: number
        totalScore: number
        defends: number
        holds: number
        totalConceded: number
      }
    >()

    for (const zone of zones) {
      zoneTypeById.set(zone.id, zone.zone_type)
      if (!zoneStatsMap.has(zone.zone_type)) {
        zoneStatsMap.set(zone.zone_type, {
          attacks: 0,
          wins: 0,
          totalScore: 0,
          defends: 0,
          holds: 0,
          totalConceded: 0
        })
      }
    }

    for (const battle of (battles ?? []) as BattleRow[]) {
      if (!battle.zone_id) continue
      const zoneType = zoneTypeById.get(battle.zone_id)
      if (zoneType === undefined) continue
      const stats = zoneStatsMap.get(zoneType)
      if (!stats) continue

      const isGuildMember = battle.is_guild_member === true
      // Loki can report 'win' after partial damage; mirrors SQL war_zone_captured,
      // using attempt_result only when there is no defender JSON.
      const isWin = isWarZoneCaptured(
        battle.attempt_result,
        battle.defender_units_json ?? undefined
      )
      const score = battle.score_earned ?? 0

      if (isGuildMember) {
        stats.attacks++
        if (isWin) stats.wins++
        stats.totalScore += score
      } else {
        stats.defends++
        if (!isWin) stats.holds++
        stats.totalConceded += score
      }
    }

    const mapStats: MapStats[] = Array.from(zoneStatsMap.entries()).map(
      ([zoneType, stats]) => ({
        // RAW: zoneDisplayName is not idempotent, and this is the image lookup key.
        zoneType,
        offense: {
          attacks: stats.attacks,
          wins: stats.wins,
          winRate:
            stats.attacks > 0
              ? Math.round((stats.wins / stats.attacks) * 100)
              : 0,
          avgScore:
            stats.attacks > 0 ? Math.round(stats.totalScore / stats.attacks) : 0
        },
        defense: {
          defends: stats.defends,
          holds: stats.holds,
          holdRate:
            stats.defends > 0
              ? Math.round((stats.holds / stats.defends) * 100)
              : 0,
          avgScoreConceded:
            stats.defends > 0
              ? Math.round(stats.totalConceded / stats.defends)
              : 0
        }
      })
    )

    return NextResponse.json(mapStats)
  }
)

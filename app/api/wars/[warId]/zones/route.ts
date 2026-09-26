import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireWarAccess } from '../_shared'
import type { ZoneCell } from '@/app/(dashboard)/wars/_types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { isWarZoneCaptured } from '@/app/lib/war/war-zone-captured'

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

    // Ship raw zone_type (never legacy zone_name); zoneDisplayName() is not idempotent.
    const { data: zones, error: zonesError } = await supabase
      .from('guild_war_zones')
      .select(
        `
      id,
      zone_number,
      zone_type,
      zone_status,
      assigned_players
    `
      )
      .eq('war_id', warId)
      .eq('guild_code', guildCode)
      .order('zone_number', { ascending: true })

    if (zonesError) {
      console.error('Error fetching zones:', zonesError)
      throw Errors.fromResponse(500, { error: 'Failed to fetch zones' })
    }

    const { data: battles, error: battlesError } = await supabase
      .from('guild_war_battles')
      .select(
        'zone_id, is_guild_member, attempt_result, defender_units_json, score_earned'
      )
      .eq('war_id', warId)
      .eq('guild_code', guildCode)

    if (battlesError) {
      console.error('Error fetching zone battles:', battlesError)
      throw Errors.fromResponse(500, { error: 'Failed to fetch zone battles' })
    }

    type ZoneStats = {
      offenseAttacks: number
      offenseWins: number
      offenseTotalScore: number
      defenseAttacks: number
      defenseLosses: number
      defenseTotalScore: number
    }
    const zoneStats = new Map<string, ZoneStats>()

    for (const b of battles ?? []) {
      if (!b.zone_id) continue
      const captured = isWarZoneCaptured(
        b.attempt_result,
        b.defender_units_json
      )
      const stats = zoneStats.get(b.zone_id) ?? {
        offenseAttacks: 0,
        offenseWins: 0,
        offenseTotalScore: 0,
        defenseAttacks: 0,
        defenseLosses: 0,
        defenseTotalScore: 0
      }
      if (b.is_guild_member) {
        stats.offenseAttacks++
        if (captured) stats.offenseWins++
        stats.offenseTotalScore += b.score_earned ?? 0
      } else {
        stats.defenseAttacks++
        if (captured) stats.defenseLosses++ // enemy capture = our loss
        stats.defenseTotalScore += b.score_earned ?? 0
      }
      zoneStats.set(b.zone_id, stats)
    }

    interface ZoneRow {
      id: string
      zone_number: number
      zone_type: string
      zone_status: string
      assigned_players: string[] | null
    }

    const zoneCells: ZoneCell[] = ((zones ?? []) as ZoneRow[]).map((z) => {
      const stats = zoneStats.get(z.id)
      const offAtk = stats?.offenseAttacks ?? 0
      const offWins = stats?.offenseWins ?? 0
      const defAtk = stats?.defenseAttacks ?? 0
      const defLosses = stats?.defenseLosses ?? 0
      const defHolds = defAtk - defLosses

      return {
        id: z.id,
        zoneType: z.zone_type,
        assignedPlayer: z.assigned_players?.[0] ?? null,
        status: mapZoneStatus(z.zone_status),
        offense: {
          attacks: offAtk,
          winRate: offAtk > 0 ? Math.round((offWins / offAtk) * 1000) / 10 : 0,
          avgScore:
            offAtk > 0
              ? Math.round((stats?.offenseTotalScore ?? 0) / offAtk)
              : 0
        },
        defense: {
          defends: defAtk,
          holdRate:
            defAtk > 0 ? Math.round((defHolds / defAtk) * 1000) / 10 : 0,
          avgConceded:
            defAtk > 0
              ? Math.round((stats?.defenseTotalScore ?? 0) / defAtk)
              : 0
        }
      }
    })

    return NextResponse.json(zoneCells)
  }
)

function mapZoneStatus(
  status: string
): 'assigned' | 'available' | 'locked' | 'destroyed' {
  switch (status) {
    case 'assigned':
    case 'in_progress':
      return 'assigned'
    case 'available':
      return 'available'
    case 'completed':
      return 'locked'
    case 'failed':
      return 'destroyed'
    default:
      return 'available'
  }
}

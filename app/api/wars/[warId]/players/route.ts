import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { requireWarAccess } from '../_shared'
import { logger } from '@/app/lib/war/logger'
import type {
  PlayerStats,
  WarPlayerStatsRow
} from '@/app/(dashboard)/wars/_types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { SupabaseClient } from '@supabase/supabase-js'

type PlayerZoneTypes = {
  /** defender player_id → RAW zone_type (modal zone of their defense battles). */
  byPlayerId: Map<string, string>
  /** display name → RAW zone_type from this guild's zone planning; guild members only */
  byPlayerName: Map<string, string>
}

/**
 * Ships RAW zone_type. Primary: modal defended zone; fallback: own-guild zone
 * planning. Failures degrade to an empty map.
 */
async function loadPlayerZoneTypes(
  supabase: SupabaseClient,
  warId: string,
  guildCode: string
): Promise<PlayerZoneTypes> {
  const byPlayerId = new Map<string, string>()
  const byPlayerName = new Map<string, string>()

  const [zonesRes, defenseRes] = await Promise.all([
    supabase
      .from('guild_war_zones')
      .select('id, zone_type, assigned_players')
      .eq('war_id', warId)
      .eq('guild_code', guildCode),
    // Bounded by war size (~600 battles max), well under PostgREST's row cap.
    supabase
      .from('guild_war_battles')
      .select('defender_player_id, zone_id')
      .eq('war_id', warId)
      .eq('guild_code', guildCode)
      .not('defender_player_id', 'is', null)
  ])

  if (zonesRes.error || defenseRes.error) {
    logger.warn('Failed to load zone data for player stats', {
      warId,
      zonesError: zonesRes.error,
      battlesError: defenseRes.error
    })
    return { byPlayerId, byPlayerName }
  }

  const zoneTypeById = new Map<string, string>()
  for (const zone of (zonesRes.data ?? []) as {
    id: string
    zone_type: string | null
    assigned_players: string[] | null
  }[]) {
    if (!zone.zone_type) continue
    zoneTypeById.set(zone.id, zone.zone_type)
    for (const name of zone.assigned_players ?? []) {
      if (!byPlayerName.has(name)) byPlayerName.set(name, zone.zone_type)
    }
  }

  const defenseCounts = new Map<string, Map<string, number>>()
  for (const row of (defenseRes.data ?? []) as {
    defender_player_id: string | null
    zone_id: string | null
  }[]) {
    const zoneType = row.zone_id ? zoneTypeById.get(row.zone_id) : undefined
    if (!row.defender_player_id || !zoneType) continue
    const perZone =
      defenseCounts.get(row.defender_player_id) ?? new Map<string, number>()
    perZone.set(zoneType, (perZone.get(zoneType) ?? 0) + 1)
    defenseCounts.set(row.defender_player_id, perZone)
  }
  for (const [playerId, perZone] of defenseCounts) {
    // Ties broken by zone_type for a stable result.
    const best = [...perZone.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0]
    if (best) byPlayerId.set(playerId, best[0])
  }

  return { byPlayerId, byPlayerName }
}

/**
 * The name-keyed planning fallback applies only to our guild members: names are not unique
 * across guilds, so a colliding opponent would otherwise leak our defensive planning.
 */
function resolveAssignedZoneType(
  row: WarPlayerStatsRow,
  zoneTypes: PlayerZoneTypes
): string | undefined {
  const defended = row.player_id
    ? zoneTypes.byPlayerId.get(row.player_id)
    : undefined
  if (defended) return defended

  if (row.is_guild_member !== true || !row.player_name) return undefined
  return zoneTypes.byPlayerName.get(row.player_name)
}

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ warId: string }> }
  ) => {
    try {
      const { warId } = await params
      const { searchParams } = new URL(request.url)
      const side = searchParams.get('side') ?? 'guild'

      if (!warId) {
        throw Errors.invalidRequest('warId is required', {
          endpoint: '/api/wars/[warId]/players'
        })
      }

      if (side !== 'guild' && side !== 'opponent') {
        throw Errors.invalidRequest('side must be "guild" or "opponent"', {
          endpoint: '/api/wars/[warId]/players'
        })
      }

      const supabase = await db()

      const { guildCode } = await requireWarAccess(supabase, warId, {
        shape: 'war-first',
        endpoint: '/api/wars/[warId]/players'
      })

      // Service-role RPC: build the client only after requireWarAccess passes.
      const privilegedSupabase = serviceDb()
      const { data: playersData, error: playersError } =
        await privilegedSupabase.rpc('get_war_player_stats', {
          p_war_id: warId,
          p_guild_code: guildCode
        })

      if (playersError) {
        logger.error('Failed to fetch player stats', {
          error: playersError,
          warId
        })
        throw Errors.database('Failed to fetch player statistics', {
          endpoint: '/api/wars/[warId]/players'
        })
      }

      const rows = (playersData as unknown as WarPlayerStatsRow[] | null) ?? []

      const zoneTypes = await loadPlayerZoneTypes(supabase, warId, guildCode)

      const filteredRows = rows.filter((row) => {
        if (side === 'guild') {
          return row.is_guild_member === true
        }
        return row.is_guild_member === false || row.is_guild_member === null
      })

      const playerStats: PlayerStats[] = filteredRows.map((row) => ({
        playerId: row.player_id ?? 'unknown',
        playerName: row.player_name ?? 'Unknown',
        isGuildMember: row.is_guild_member ?? undefined,
        assignedZoneType: resolveAssignedZoneType(row, zoneTypes),
        attacks: {
          total: Number(row.total_attacks) || 0,
          wins: Number(row.wins) || 0,
          losses: Number(row.losses) || 0,
          points: Number(row.points) || 0,
          perfect: Number(row.perfect_hits) || 0,
          failed: Number(row.failed_hits) || 0,
          winRate: Number(row.win_rate) || 0,
          avgScore: Number(row.avg_score) || 0
        },
        defenses: {
          // Older RPC shapes lack the defensive columns.

          total: Number(row.defended ?? 0) || 0,
          holds: Number(row.held ?? 0) || 0,
          breaches: Number(row.breached ?? 0) || 0,
          conceded: Number(row.conceded ?? 0) || 0,
          holdRate: Number(row.hold_rate ?? 0) || 0
        }
      }))

      return NextResponse.json(playerStats)
    } catch (error) {
      rethrowIfAppError(error)
      logger.error('Error in war players endpoint', { error })
      throw Errors.fromResponse(500, {
        error: error instanceof Error ? error.message : 'Internal server error'
      })
    }
  }
)

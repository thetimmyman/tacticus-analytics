import { NextRequest, NextResponse } from 'next/server'
import { requireWarFirstRouteContext } from '../_shared'
import { logger } from '@/app/lib/war/logger'
import { buildBoardSides } from '@/app/(dashboard)/wars/[warId]/board/board-utils'
import type { WarBattleRosterRow } from '@/app/(dashboard)/wars/[warId]/board/board-utils'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

/**
 * Full participant list (attackers and defenders) so zero-token members appear.
 * RLS and the explicit guild-access check both scope to the caller's guild.
 */
export const GET = withErrorHandler(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ warId: string }> }
  ) => {
    try {
      const { guildCode, supabase, warId } = await requireWarFirstRouteContext(
        { params },
        '/api/wars/[warId]/board'
      )

      const { data: battleRows, error: battlesError } = await supabase
        .from('guild_war_battles')
        .select(
          'attacker_player_id, attacker_player_name, defender_player_id, defender_player_name, is_guild_member, score_earned, attempt_result, attacker_units_json, defender_units_json'
        )
        .eq('war_id', warId)
        .eq('guild_code', guildCode)

      if (battlesError) {
        logger.error('Failed to fetch war battles', {
          error: battlesError,
          warId
        })
        throw Errors.database('Failed to fetch war battles', {
          endpoint: '/api/wars/[warId]/board'
        })
      }

      const sides = buildBoardSides(
        (battleRows as WarBattleRosterRow[] | null) ?? []
      )

      return NextResponse.json(sides)
    } catch (error) {
      rethrowIfAppError(error)
      logger.error('Error in war board endpoint', { error })
      throw Errors.fromResponse(500, {
        error: error instanceof Error ? error.message : 'Internal server error'
      })
    }
  }
)

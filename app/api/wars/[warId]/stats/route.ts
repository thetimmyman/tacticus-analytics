import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { requireWarFirstRouteContext } from '../_shared'
import { logger } from '@/app/lib/war/logger'
import type { WarStats, WarStatsRow } from '@/app/(dashboard)/wars/_types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const GET = withErrorHandler(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ warId: string }> }
  ) => {
    try {
      const { guildCode, warId } = await requireWarFirstRouteContext(
        { params },
        '/api/wars/[warId]/stats'
      )

      // Service role only after requireWarAccess succeeds on the request client.
      const privilegedSupabase = serviceDb()
      const { data: statsData, error: statsError } =
        await privilegedSupabase.rpc('get_war_stats', {
          p_war_id: warId,
          p_guild_code: guildCode
        })

      if (statsError) {
        logger.error('Failed to fetch war stats', { error: statsError, warId })
        throw Errors.database('Failed to fetch war statistics', {
          endpoint: '/api/wars/[warId]/stats'
        })
      }

      const row = (statsData as unknown as WarStatsRow[] | null)?.[0]

      if (!row) {
        const emptyStats: WarStats = {
          ourAttacks: 0,
          theirAttacks: 0,
          perfectHits: 0,
          failedHits: 0,
          ourWins: 0,
          theirWins: 0,
          ourPoints: 0,
          theirPoints: 0,
          winRate: 0,
          holdRate: 0,
          avgScore: 0
        }
        return NextResponse.json(emptyStats)
      }

      const warStats: WarStats = {
        ourAttacks: Number(row.our_attacks) || 0,
        theirAttacks: Number(row.their_attacks) || 0,
        perfectHits: Number(row.perfect_hits) || 0,
        failedHits: Number(row.failed_hits) || 0,
        ourWins: Number(row.our_wins) || 0,
        theirWins: Number(row.their_wins) || 0,
        ourPoints: Number(row.our_points) || 0,
        theirPoints: Number(row.their_points) || 0,
        winRate: Number(row.win_rate) || 0,
        holdRate: Number(row.hold_rate) || 0,
        avgScore: Number(row.avg_score) || 0
      }

      return NextResponse.json(warStats)
    } catch (error) {
      rethrowIfAppError(error)
      logger.error('Error in war stats endpoint', { error })
      throw Errors.fromResponse(500, {
        error: error instanceof Error ? error.message : 'Internal server error'
      })
    }
  }
)

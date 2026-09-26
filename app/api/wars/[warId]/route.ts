import { NextRequest, NextResponse } from 'next/server'
import { requireWarFirstRouteContext } from './_shared'
import { logger } from '@/app/lib/war/logger'
import type {
  WarInfo,
  WarResult,
  WarStatus
} from '@/app/(dashboard)/wars/_types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

export const GET = withErrorHandler(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ warId: string }> }
  ) => {
    try {
      const { supabase, warId } = await requireWarFirstRouteContext(
        { params },
        '/api/wars/[warId]'
      )

      const { data: warMatch, error: warError } = await supabase
        .from('guild_war_matches')
        .select(
          `
        war_id,
        guild_code,
        opponent_guild_name,
        opponent_guild_code,
        war_status,
        guild_score,
        opponent_score,
        war_start_date,
        war_end_date,
        war_result,
        battlefield_level,
        war_season
      `
        )
        .eq('war_id', warId)
        .limit(1)
        .maybeSingle()

      if (warError) {
        logger.error('Failed to fetch war match', { error: warError, warId })
        throw Errors.database('Failed to fetch war data', {
          endpoint: '/api/wars/[warId]'
        })
      }

      if (!warMatch) {
        throw Errors.notFound('War', 'War not found')
      }

      const guildConfig = await GuildConfigService.getBasic(
        supabase,
        warMatch.guild_code
      )
      const guildName = guildConfig?.display_name ?? warMatch.guild_code
      const guildTag = warMatch.guild_code

      const statusMap: Record<string, WarStatus> = {
        pending: 'scheduled',
        active: 'in_progress',
        completed: 'completed',
        cancelled: 'cancelled'
      }

      const resultMap: Record<string, WarResult> = {
        win: 'win',
        loss: 'loss',
        draw: 'draw'
      }

      const warInfo: WarInfo = {
        warId: warMatch.war_id,
        warSlug: `${guildTag.toLowerCase()}-vs-${(warMatch.opponent_guild_code ?? 'opp').toLowerCase()}`,
        status: statusMap[warMatch.war_status ?? 'completed'] ?? 'completed',
        startTime: warMatch.war_start_date ?? new Date().toISOString(),
        endTime: warMatch.war_end_date ?? undefined,
        result: warMatch.war_result
          ? (resultMap[warMatch.war_result] ?? null)
          : null,
        guild: {
          guildCode: warMatch.guild_code,
          guildName,
          guildTag,
          score: warMatch.guild_score ?? 0
        },
        opponent: {
          guildCode: warMatch.opponent_guild_code ?? undefined,
          guildName: warMatch.opponent_guild_name ?? 'Unknown Opponent',
          guildTag: warMatch.opponent_guild_code ?? '???',
          score: warMatch.opponent_score ?? 0
        }
      }

      return NextResponse.json(warInfo)
    } catch (error) {
      rethrowIfAppError(error)
      logger.error('Error in war info endpoint', { error })
      throw Errors.fromResponse(500, {
        error: error instanceof Error ? error.message : 'Internal server error'
      })
    }
  }
)

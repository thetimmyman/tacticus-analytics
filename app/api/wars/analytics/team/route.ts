import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.wars.analytics.team')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { profile } = await requireActiveMembershipForApi()

  try {
    const guildCode = profile.guild_code

    if (!guildCode) {
      throw Errors.fromResponse(400, { error: 'No guild associated with user' })
    }

    const body = await request.json()
    const { heroKeys, seasonCount = 4 } = body

    if (!heroKeys || !Array.isArray(heroKeys) || heroKeys.length !== 5) {
      throw Errors.fromResponse(400, {
        error: 'heroKeys must be an array of exactly 5 hero IDs'
      })
    }

    const supabase = serviceDb()

    const { data, error } = await supabase.rpc('analyze_team_composition', {
      p_guild_code: guildCode,
      p_hero_keys: heroKeys,
      p_season_count: seasonCount
    })

    if (error) {
      // 42883: RPC not deployed.
      if (error.code === '42883') {
        return NextResponse.json({
          analysis: {
            totalUsed: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            avgScore: 0,
            zoneBreakdown: [],
            debuffBreakdown: [],
            matchups: []
          }
        })
      }
      logger.error(
        { error: error.message, guildCode, heroKeys },
        'Failed to analyze team composition'
      )
      throw Errors.fromResponse(500, {
        error: `Failed to analyze team composition: ${error.message}`
      })
    }

    interface TeamAnalysisRow {
      total_uses?: number | string
      wins?: number | string
      losses?: number | string
      win_rate?: number | string
      avg_score?: number | string
      /** MISNOMER, do not "fix": the RPC puts the RAW zone_type id under `zoneName`. */
      zone_breakdown?: Array<{
        zoneName: string
        uses: number
        winRate: number
      }>
      buff_breakdown?: Array<{
        debuffLevel: string
        uses: number
        winRate: number
      }>
      matchup_summary?: unknown[]
    }
    const result: TeamAnalysisRow = (data?.[0] as
      TeamAnalysisRow | undefined) ?? {
      total_uses: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      avg_score: 0,
      zone_breakdown: [],
      buff_breakdown: [],
      matchup_summary: []
    }

    return NextResponse.json({
      analysis: {
        totalUsed: Number(result.total_uses) || 0,
        wins: Number(result.wins) || 0,
        losses: Number(result.losses) || 0,
        winRate: Number(result.win_rate) || 0,
        avgScore: Number(result.avg_score) || 0,
        // Raw zone_type: zoneDisplayName is not idempotent, so only the render site formats it.
        zoneBreakdown: (result.zone_breakdown ?? []).map((z) => ({
          zoneType: z.zoneName,
          uses: Number(z.uses),
          winRate: Number(z.winRate)
        })),
        debuffBreakdown: (result.buff_breakdown ?? []).map((b) => ({
          debuffLevel: b.debuffLevel,
          uses: Number(b.uses),
          winRate: Number(b.winRate)
        })),
        matchups: result.matchup_summary || []
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Team analysis API error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-raid.season-plan')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSeasonPlanOfficerContext } from './_shared'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const { supabase, profile } = await requireSeasonPlanOfficerContext()

    const searchParams = request.nextUrl.searchParams
    const planId = searchParams.get('id')
    const seasonId = searchParams.get('season_id')

    if (planId) {
      const { data, error } = await supabase
        .from('guild_raid_season_plans')
        .select('*')
        .eq('id', planId)
        .eq('guild_code', profile.guild_code)
        .single()

      if (error || !data) {
        throw Errors.fromResponse(404, { error: 'Plan not found' })
      }

      return NextResponse.json({ plan: data })
    }

    if (!seasonId) {
      throw Errors.fromResponse(400, { error: 'Missing id or season_id' })
    }

    const { data, error } = await supabase
      .from('guild_raid_season_plans')
      .select(
        'id, season_id, start_at, end_at, snapshot_at, kind, baseline_key, baseline_plan_id, trigger, resolved_options, seed, plan_hash, plan_metrics, created_by, created_at, updated_at'
      )
      .eq('guild_code', profile.guild_code)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false })
      .limit(25)

    if (error) {
      logger.error({ error: error.message }, 'Failed to load season plans')
      throw Errors.fromResponse(500, { error: 'Failed to load plans' })
    }

    return NextResponse.json({ plans: data ?? [] })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error in season-plan API:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

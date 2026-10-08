import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { parsePlanId, parsePlanSeasonId } from './validation'
import { parseSeasonParam } from '@/app/lib/boss-assignments/target-token-season'
import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-raid.season-plan')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  requireSeasonPlanOfficerContext,
  requireSeasonPlanReadContext
} from './_shared'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const desktop = getRuntimeProfile() === 'desktop'
    const { supabase, profile } = await (desktop
      ? requireSeasonPlanReadContext()
      : requireSeasonPlanOfficerContext())

    const searchParams = request.nextUrl.searchParams
    const planId = searchParams.get('id')
    const seasonId = searchParams.get('season_id')
    const headers = desktop ? { 'Cache-Control': 'no-store' } : undefined
    if (desktop && searchParams.has('id')) parsePlanId(planId)

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

      return NextResponse.json({ plan: data }, { headers })
    }

    if (!seasonId) {
      throw Errors.fromResponse(400, { error: 'Missing id or season_id' })
    }

    const season = desktop ? parseSeasonParam(searchParams.get('season')) : null
    if (desktop && !season)
      throw Errors.fromResponse(400, { error: 'Invalid saved season' })
    if (desktop) parsePlanSeasonId(seasonId)
    let query = supabase
      .from('guild_raid_season_plans')
      .select(
        'id, season_id, start_at, end_at, snapshot_at, kind, baseline_key, baseline_plan_id, trigger, resolved_options, seed, plan_hash, plan_metrics, created_by, created_at, updated_at'
      )
      .eq('guild_code', profile.guild_code)
      .eq('season_id', seasonId)
    if (desktop) query = query.eq('plan->>season', season!)
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(25)

    if (error) {
      logger.error({ error: error.message }, 'Failed to load season plans')
      throw Errors.fromResponse(500, { error: 'Failed to load plans' })
    }

    return NextResponse.json({ plans: data ?? [] }, { headers })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error in season-plan API:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (getRuntimeProfile() !== 'desktop')
    return NextResponse.json(
      { error: 'Method not available' },
      { status: 405, headers: { Allow: 'GET' } }
    )
  const { supabase, profile } = await requireSeasonPlanOfficerContext({
    requireFeatureAccess: getRuntimeProfile() === 'desktop'
  })
  const id = parsePlanId(request.nextUrl.searchParams.get('id'))
  const { data, error } = await supabase
    .from('guild_raid_season_plans')
    .delete()
    .eq('id', id)
    .eq('guild_code', profile.guild_code)
    .select('id')
    .maybeSingle()
  if (error?.code === '42501')
    throw Errors.fromResponse(403, { error: 'Plan deletion refused' })
  if (error) throw Errors.fromResponse(500, { error: 'Plan was not deleted' })
  if (!data || data.id !== id)
    throw Errors.fromResponse(404, {
      error: 'Plan not found or deletion refused'
    })
  return NextResponse.json(
    { success: true, id },
    { headers: { 'Cache-Control': 'no-store' } }
  )
})

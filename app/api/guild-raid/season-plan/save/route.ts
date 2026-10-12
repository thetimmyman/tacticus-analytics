import {
  resolveSavedPlanningRotation,
  resolveSavedSeasonWindow
} from '@/app/lib/boss-assignments/season-planner/saved-season'
import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { readBoundedPlanBody, validateSavedPlan } from '../validation'
import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-raid.season-plan.save')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  requireSeasonPlanOfficerContext,
  resolveSeasonPlanSeason
} from '../_shared'

export const dynamic = 'force-dynamic'

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type SaveSeasonPlanRequest = {
  season_id: string
  start_at: string
  end_at: string
  snapshot_at?: string | null
  kind?: 'baseline' | 'replan'
  baseline_key?: string | null
  baseline_plan_id?: string | null
  trigger?: string | null
  resolved_options?: unknown
  seed?: number | null
  plan_hash?: string | null
  input_snapshots?: unknown
  plan_metrics?: unknown
  plan: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const desktop = getRuntimeProfile() === 'desktop'
    const { supabase, user, profile } = await requireSeasonPlanOfficerContext({
      requireFeatureAccess: desktop
    })
    if (desktop) {
      const body = validateSavedPlan(
        await readBoundedPlanBody(request),
        profile.guild_code
      )
      await resolveSeasonPlanSeason(
        body.plan.season,
        supabase,
        profile.guild_code
      )
      resolveSavedPlanningRotation(
        body.plan.season,
        body.snapshot_at,
        body.season_id
      )
      const window = resolveSavedSeasonWindow(body.plan.season)
      if (
        Date.parse(body.start_at) !== window.seasonStartMs ||
        Date.parse(body.end_at) !== window.seasonEndMs
      )
        throw Errors.fromResponse(400, {
          error: 'Plan dates do not match the selected season'
        })
      const plannedPlayers = new Set(
        body.plan.plan.sessions.map((session) => session.playerId)
      )
      if (plannedPlayers.size) {
        const { data: roster, error } = await guildRosterQuery(
          supabase,
          profile.guild_code,
          'player_id'
        )
        if (error)
          throw Errors.fromResponse(503, { error: 'Saved roster unavailable' })
        const allowed = new Set(
          (roster ?? []).map((member) => member.player_id)
        )
        if ([...plannedPlayers].some((id) => !allowed.has(id)))
          throw Errors.fromResponse(400, {
            error: 'Plan player is outside the current guild roster'
          })
      }
      if (body.baseline_plan_id || body.id) {
        for (const reference of [body.baseline_plan_id, body.id].filter(
          (value): value is string => Boolean(value)
        )) {
          const { data, error } = await supabase
            .from('guild_raid_season_plans')
            .select('id, season_id, plan')
            .eq('id', reference)
            .eq('guild_code', profile.guild_code)
            .eq('season_id', body.season_id)
            .eq('plan->>season', body.plan.season)
            .maybeSingle()
          if (
            error ||
            !data ||
            data.season_id !== body.season_id ||
            (data.plan as { season?: unknown })?.season !== body.plan.season
          )
            throw Errors.fromResponse(body.id === reference ? 404 : 400, {
              error: 'Plan reference not found in this guild and season'
            })
        }
      }
      const row = {
        season_id: body.season_id,
        start_at: body.start_at,
        end_at: body.end_at,
        snapshot_at: body.snapshot_at,
        kind: body.kind ?? 'replan',
        baseline_key: body.baseline_key ?? null,
        baseline_plan_id: body.baseline_plan_id ?? null,
        trigger: body.trigger ?? 'manual',
        resolved_options: (body.resolved_options ?? {}) as Json,
        seed: body.seed ?? null,
        plan_hash: body.plan_hash ?? null,
        input_snapshots: (body.input_snapshots ?? {}) as Json,
        plan_metrics: (body.plan_metrics ?? body.plan.plan.metrics) as Json,
        plan: body.plan as Json
      }
      const query = body.id
        ? supabase
            .from('guild_raid_season_plans')
            .update(row)
            .eq('id', body.id)
            .eq('guild_code', profile.guild_code)
            .eq('season_id', body.season_id)
            .eq('plan->>season', body.plan.season)
        : supabase.from('guild_raid_season_plans').insert({
            ...row,
            guild_code: profile.guild_code,
            created_by: user.id
          })
      const { data, error } = await query.select('id').single()
      if (error?.code === '42501')
        throw Errors.fromResponse(403, { error: 'Plan write refused' })
      if (error || !data)
        throw Errors.fromResponse(body.id ? 404 : 500, {
          error: 'Plan was not saved'
        })
      return NextResponse.json(
        { success: true, id: data.id },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const body = (await request.json()) as Partial<SaveSeasonPlanRequest>

    if (!isNonEmptyString(body.season_id)) {
      throw Errors.fromResponse(400, { error: 'season_id is required' })
    }

    if (!isNonEmptyString(body.start_at) || !isNonEmptyString(body.end_at)) {
      throw Errors.fromResponse(400, {
        error: 'start_at and end_at are required'
      })
    }

    if (body.plan === undefined) {
      throw Errors.fromResponse(400, { error: 'plan is required' })
    }

    const resolvedOptions = (body.resolved_options ?? {}) as Json
    const inputSnapshots = (body.input_snapshots ?? {}) as Json
    const planMetrics = (body.plan_metrics ?? {}) as Json
    const plan = body.plan as Json

    const { data, error } = await supabase
      .from('guild_raid_season_plans')
      .insert({
        guild_code: profile.guild_code,
        season_id: body.season_id,
        start_at: body.start_at,
        end_at: body.end_at,
        snapshot_at: body.snapshot_at ?? null,
        kind: body.kind ?? 'replan',
        baseline_key: body.baseline_key ?? null,
        baseline_plan_id: body.baseline_plan_id ?? null,
        trigger: body.trigger ?? 'manual',
        resolved_options: resolvedOptions,
        seed: body.seed ?? null,
        plan_hash: body.plan_hash ?? null,
        input_snapshots: inputSnapshots,
        plan_metrics: planMetrics,
        plan,
        created_by: user.id
      })
      .select('id')
      .single()

    if (error || !data) {
      logger.error({ error: error?.message }, 'Failed to save season plan')
      throw Errors.fromResponse(500, { error: 'Failed to save plan' })
    }

    return NextResponse.json({ success: true, id: data.id })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error saving season plan:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

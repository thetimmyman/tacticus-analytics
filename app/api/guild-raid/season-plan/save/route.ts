import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-raid.season-plan.save')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSeasonPlanOfficerContext } from '../_shared'

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
    const { supabase, user, profile } = await requireSeasonPlanOfficerContext()

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

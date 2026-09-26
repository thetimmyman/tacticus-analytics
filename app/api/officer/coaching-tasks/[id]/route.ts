/** The task's guild_code check is the real boundary (service role bypasses RLS). Closed tasks are terminal. */

import { serviceDb } from '@/app/lib/db'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireActiveOfficerCommandAccess } from '../../_shared/access'
import {
  ACTIVE_STATUSES,
  VALID_RESOLUTIONS,
  VALID_STATUSES,
  validateCoachingTaskResolution,
  validateCoachingTaskTransition,
  type CoachingTaskStatus,
  type PatchableCoachingTaskStatus
} from '../_guards'

export const PATCH = withErrorHandler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { guildCode } = await requireActiveOfficerCommandAccess()

    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as {
      status?: PatchableCoachingTaskStatus
      resolution?: string
    }
    if (!body.status || !VALID_STATUSES.has(body.status)) {
      throw Errors.fromResponse(400, {
        error: 'status must be one of acknowledged | dismissed | resolved'
      })
    }
    const resolutionError = validateCoachingTaskResolution(
      body.status,
      body.resolution
    )
    if (resolutionError) {
      throw Errors.fromResponse(400, {
        error: resolutionError,
        allowed: [...VALID_RESOLUTIONS]
      })
    }

    const supabase = serviceDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any

    const existing = await sbAny
      .from('coaching_tasks')
      .select('id, status')
      .eq('id', id)
      .eq('guild_code', guildCode)
      .maybeSingle()
    if (existing.error || !existing.data) {
      throw Errors.fromResponse(404, { error: 'Coaching task not found' })
    }
    const currentStatus = existing.data.status as CoachingTaskStatus
    const transitionError = validateCoachingTaskTransition(
      currentStatus,
      body.status
    )
    if (transitionError) {
      throw Errors.fromResponse(409, {
        error: transitionError,
        status: currentStatus
      })
    }

    const update: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString()
    }
    if (body.status === 'resolved') {
      update.resolution = body.resolution
      update.resolved_at = new Date().toISOString()
    } else if (body.status === 'dismissed') {
      update.resolution = 'dismissed'
      update.resolved_at = new Date().toISOString()
    } else {
      update.resolution = null
      update.resolved_at = null
    }

    const { data: updated, error } = await sbAny
      .from('coaching_tasks')
      .update(update)
      .eq('id', id)
      .eq('guild_code', guildCode)
      .in('status', ACTIVE_STATUSES)
      .select('id')
      .maybeSingle()
    if (error) {
      throw Errors.fromResponse(500, {
        error: 'Failed to update coaching task'
      })
    }
    if (!updated) {
      throw Errors.fromResponse(409, {
        error: 'Coaching task was already closed by another request'
      })
    }

    return Response.json({ ok: true })
  }
)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import {
  reconcileGuildRoles,
  type ReconcileResult
} from '@/app/lib/discord/role-reconciler'
import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'

const logger = createComponentLogger('api.guild-roles.reconcile')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENDPOINT = '/api/guild-roles/reconcile'

// Runs even when auto_role_assign_enabled is off.
export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => null)) as {
      guild_code?: string
    } | null
    if (!body || typeof body.guild_code !== 'string' || !body.guild_code) {
      throw Errors.validation('guild_code is required', { endpoint: ENDPOINT })
    }

    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.authenticationRequired('Authentication required', {
        endpoint: ENDPOINT
      })
    )

    await requireGuildOfficerOrClusterLeader(
      supabase,
      user.id,
      body.guild_code,
      ENDPOINT
    )

    logger.info(
      { guildCode: body.guild_code, triggered_by: user.id },
      'manual_resync.start'
    )

    const result: ReconcileResult = await reconcileGuildRoles(
      supabase as unknown as ServiceSupabaseClient,
      body.guild_code,
      {
        trigger_source: 'manual_resync',
        triggered_by: user.id,
        force: true
      }
    )

    return NextResponse.json({ success: true, result })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'manual_resync.error')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

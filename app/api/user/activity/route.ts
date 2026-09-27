import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import {
  expectedErrorResponse,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { createComponentLogger } from '@/app/lib/logging'
import type { TablesUpdate } from '@tacticus/app-core/database.generated'

const logger = createComponentLogger('api.user.activity')

// Transient infra failures: the heartbeat retries on the next page view, so no Sentry error.
const TRANSIENT_PG_CODES = new Set([
  '57014', // statement canceled / timeout
  '40001', // serialization failure
  '40P01' // deadlock detected
])

function isTransientDbFailure(
  code: string | null | undefined,
  status: number | undefined
): boolean {
  if (status === 502 || status === 503 || status === 504) return true
  if (!code) return false
  return (
    code.startsWith('PGRST0') || // PostgREST connection group (PGRST000/001/003)
    code.startsWith('08') || // PG connection exceptions
    code.startsWith('53') || // PG insufficient resources (53300 etc.)
    TRANSIENT_PG_CODES.has(code)
  )
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('Authentication required')
  )

  const {
    data: membership,
    error,
    status
  } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .update({
      last_active_at: new Date().toISOString()
    } as TablesUpdate<'player_mapping'>)
    .eq('user_id', user.id)
    .eq('is_current', true)
    .select('guild_code')

  if (error) {
    if (isTransientDbFailure(error.code, status)) {
      logger.warn(
        { err: error, dbCode: error.code, status },
        'Activity heartbeat skipped — transient database unavailability'
      )
      return expectedErrorResponse(
        Errors.fromStatus(503, 'Unable to update activity status', {
          endpoint: '/api/user/activity',
          transient: true
        }),
        request
      )
    }
    // Full error is logged; the raw message stays out of the client response.
    logger.error(
      {
        err: error,
        dbCode: error.code,
        details: error.details,
        hint: error.hint
      },
      'Failed to update member activity'
    )
    throw Errors.database('Unable to update activity status', {
      endpoint: '/api/user/activity',
      dbCode: error.code ?? null
    })
  }

  // Service client: guild_config RLS only lets leaders/officers update, so members would
  // silently fail to promote the guild to the 'active' sync tier.
  const guildCode = membership?.[0]?.guild_code
  if (guildCode) {
    const serviceSupabase = serviceDb()
    await serviceSupabase
      .from('guild_config')
      .update({
        sync_tier: 'active',
        updated_at: new Date().toISOString()
      } as TablesUpdate<'guild_config'>)
      .eq('guild_code', guildCode)
      .neq('sync_tier', 'active')
  }

  return NextResponse.json({ success: true })
})

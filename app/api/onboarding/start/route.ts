import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.start')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  getOrCreateOnboardingProgress,
  resetStatusFields
} from '@/app/lib/onboarding/progress'
import type { GuildMode } from '@tacticus/app-core/onboarding.types'

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Unauthorized' })
    )

    const { guildMode }: { guildMode?: GuildMode } = await request.json()

    if (!guildMode || !['existing_guild', 'new_guild'].includes(guildMode)) {
      throw Errors.fromResponse(400, { error: 'Invalid guild mode' })
    }

    const progress = await getOrCreateOnboardingProgress(supabase, user.id)

    if (!progress) {
      throw Errors.fromResponse(500, {
        error: 'Unable to initialise onboarding progress'
      })
    }

    // Never clear guild_code after registration: re-registering 409s and the fallback would demote the registrar.
    if (progress.guild_status === 'complete' && progress.guild_code) {
      const { data: preserved, error: preserveError } = await supabase
        .from('onboarding_progress')
        .update(resetStatusFields(progress, { guild_mode: guildMode }))
        .eq('user_id', user.id)
        .select('*')
        .single()

      if (preserveError || !preserved) {
        logger.error(
          { err: preserveError },
          'Failed to record onboarding mode for a completed guild'
        )
        throw Errors.fromResponse(500, {
          error: 'Failed to update onboarding mode'
        })
      }

      return NextResponse.json({ progress: preserved })
    }

    const baseUpdate = resetStatusFields(progress, {
      guild_status: 'not_started',
      guild_code: null,
      guild_name: null,
      guild_lock_expires_at: null,
      sync_status: guildMode === 'new_guild' ? 'pending' : 'not_required',
      sync_progress: 0,
      sync_records_synced: 0,
      profile_status: 'not_started',
      player_id: null,
      player_name: null,
      role_intent: guildMode === 'new_guild' ? 'leader' : 'member',
      guild_mode: guildMode
    })

    const { data: updated, error: updateError } = await supabase
      .from('onboarding_progress')
      .update(baseUpdate)
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (updateError || !updated) {
      logger.error({ err: updateError }, 'Failed to update onboarding mode')
      throw Errors.fromResponse(500, {
        error: 'Failed to update onboarding mode'
      })
    }

    return NextResponse.json({ progress: updated })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Onboarding start failed')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

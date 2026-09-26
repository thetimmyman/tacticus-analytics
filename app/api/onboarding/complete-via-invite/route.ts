import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.complete-via-invite')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  getOrCreateOnboardingProgress,
  resetStatusFields
} from '@/app/lib/onboarding/progress'
import { syncDiscordProfile } from '@/app/lib/discord/sync-profile'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'

/** Uses the caller's player_mapping; no body. */
export const POST = withErrorHandler(async (_request: NextRequest) => {
  const authedSupabase = await db()
  const user = await requireSessionUser(authedSupabase, () =>
    Errors.fromResponse(401, { error: 'Unauthorized' })
  )

  const serviceSupabase = serviceDb()

  try {
    const { data: playerMapping, error: mappingError } = await serviceSupabase
      .from('player_mapping')
      .select('player_id, display_name, guild_code, role')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    if (mappingError) {
      logger.error(
        { err: mappingError },
        '[CompleteViaInvite] Failed to query player_mapping'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to look up player mapping'
      })
    }

    if (!playerMapping || !playerMapping.guild_code) {
      throw Errors.fromResponse(404, {
        error:
          'No active player mapping found. The invite code may not have been applied correctly.'
      })
    }

    const { data: guildConfig, error: guildError } = await serviceSupabase
      .from('guild_config')
      .select('guild_code, display_name, onboarding_completed')
      .eq('guild_code', playerMapping.guild_code)
      .maybeSingle()

    if (guildError) {
      logger.error(
        { err: guildError },
        '[CompleteViaInvite] Failed to query guild_config'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to look up guild configuration'
      })
    }

    if (!guildConfig) {
      throw Errors.fromResponse(404, { error: 'Guild not found in system.' })
    }

    const progress = await getOrCreateOnboardingProgress(
      authedSupabase,
      user.id
    )

    if (!progress) {
      throw Errors.fromResponse(500, {
        error: 'Unable to load onboarding progress'
      })
    }

    const { data: updated, error: updateError } = await authedSupabase
      .from('onboarding_progress')
      .update(
        resetStatusFields(progress, {
          guild_mode: 'existing_guild',
          role_intent: canManageHeraldRole(playerMapping.role)
            ? 'leader'
            : 'member',
          guild_status: 'complete',
          guild_code: playerMapping.guild_code,
          guild_name: guildConfig.display_name || playerMapping.guild_code,
          sync_status: 'not_required',
          profile_status: 'complete',
          player_id: playerMapping.player_id,
          player_name: playerMapping.display_name
        })
      )
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (updateError) {
      logger.error(
        { err: updateError },
        '[CompleteViaInvite] Failed to update onboarding_progress'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to update onboarding progress'
      })
    }

    if (!guildConfig.onboarding_completed) {
      await serviceSupabase
        .from('guild_config')
        .update({
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('guild_code', playerMapping.guild_code)
    }

    // Keeps middleware from redirecting back to onboarding.
    const targetRole = playerMapping.role || 'member'
    const { error: metaError } =
      await serviceSupabase.auth.admin.updateUserById(user.id, {
        user_metadata: { role: targetRole }
      })
    if (metaError) {
      logger.warn(
        {
          userId: user.id,
          error: metaError.message
        },
        '[CompleteViaInvite] Failed to update user_metadata.role'
      )
    }

    // A Discord signup synced before the claim bound user_id; re-sync so DMs get discord_user_id.
    try {
      await syncDiscordProfile(authedSupabase, user)
    } catch (syncError) {
      logger.warn(
        { syncError, userId: user.id },
        '[CompleteViaInvite] Discord profile sync after claim failed'
      )
    }

    return NextResponse.json({
      success: true,
      progress: updated,
      player: {
        id: playerMapping.player_id,
        guild_code: playerMapping.guild_code,
        name: playerMapping.display_name
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, '[CompleteViaInvite] Failed')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

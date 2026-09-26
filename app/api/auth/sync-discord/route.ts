import { db } from '@/app/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.auth.sync-discord')
import { featureFlags } from '@/app/lib/utils/feature-flags'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { syncDiscordProfile } from '@/app/lib/discord/sync-profile'
import {
  confirmDiscordIdentityUnlink,
  parseDiscordUnlinkConfirmation,
  parseDiscordUnlinkPreparation,
  prepareDiscordIdentityUnlink
} from '@/app/lib/auth/player-authority-lifecycle'
import {
  DISCORD_RELINK_STATE_COOKIE,
  discordRelinkCookieOptions,
  sealDiscordRelinkState,
  unsealDiscordRelinkState
} from '@/app/lib/auth/discord-relink-state'
import { activatePendingDiscordRelink } from '@/app/lib/auth/discord-relink-activation'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'

export const dynamic = 'force-dynamic'

/** Manual re-sync only; the OAuth callback syncs directly so the token never crosses HTTP. */
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!featureFlags.discordAuth) {
    throw Errors.forbidden('Discord authentication is disabled')
  }

  const supabase = await db()

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser()

  if (userError || !user) {
    logger.error({ err: userError }, '[Discord Sync] User not authenticated')
    throw Errors.unauthorized('Unauthorized')
  }
  await assertUnbannedAuthUser(user)

  try {
    const activation = await activatePendingDiscordRelink(
      supabase,
      user,
      request.cookies.get(DISCORD_RELINK_STATE_COOKIE)?.value
    )
    const result = await syncDiscordProfile(supabase, user)
    if (result.status === 'no_identity') {
      return NextResponse.json(
        { message: 'No Discord identity found' },
        { status: 200 }
      )
    }
    if (result.status === 'unclaimed') {
      return NextResponse.json(
        { message: 'Complete onboarding before syncing your Discord profile' },
        { status: 200 }
      )
    }
    const response = NextResponse.json({
      message: 'Discord profile synced successfully',
      discord_username: result.discordUsername
    })
    if (activation) response.cookies.delete(DISCORD_RELINK_STATE_COOKIE)
    return response
  } catch (err) {
    logger.error({ err, userId: user.id }, '[Discord Sync] Sync failed')
    throw Errors.internal('Failed to sync Discord profile')
  }
})

export const DELETE = withErrorHandler(async (_request: NextRequest) => {
  if (!featureFlags.discordAuth) {
    throw Errors.forbidden('Discord authentication is disabled')
  }

  const supabase = await db()

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser()

  if (userError || !user) {
    logger.error({ err: userError }, '[Discord Unlink] User not authenticated:')
    throw Errors.unauthorized('Unauthorized')
  }
  await assertUnbannedAuthUser(user)

  const { data, error } = await prepareDiscordIdentityUnlink(supabase)
  if (error) {
    logger.error(
      { err: error, userId: user.id },
      '[Discord Unlink] Failed to prepare canonical unlink'
    )
    throw Errors.internal('Failed to prepare Discord unlink')
  }
  const preparation = parseDiscordUnlinkPreparation(data)
  if (!preparation) throw Errors.internal('Failed to prepare Discord unlink')
  const sealedState = await sealDiscordRelinkState(user.id, preparation)

  logger.info(
    { userId: user.id, unlinkId: preparation.unlinkId },
    '[Discord Unlink] DB authority cleared'
  )

  const response = NextResponse.json({
    success: true,
    unlinkId: preparation.unlinkId,
    generation: preparation.generation,
    providerUnlinkRequired: preparation.providerUnlinkRequired,
    message: 'Discord authority cleared; provider unlink may proceed'
  })
  response.cookies.set(
    DISCORD_RELINK_STATE_COOKIE,
    sealedState,
    discordRelinkCookieOptions
  )
  return response
})

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  if (!featureFlags.discordAuth) {
    throw Errors.forbidden('Discord authentication is disabled')
  }

  const supabase = await db()
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser()
  if (userError || !user) {
    throw Errors.unauthorized('Unauthorized')
  }
  await assertUnbannedAuthUser(user)

  const state = await unsealDiscordRelinkState(
    request.cookies.get(DISCORD_RELINK_STATE_COOKIE)?.value
  )
  if (!state || state.userId !== user.id) {
    throw Errors.conflict('Discord unlink state is missing or expired')
  }

  const { data, error } = await confirmDiscordIdentityUnlink(
    supabase,
    state.unlinkId
  )
  if (error) {
    logger.error(
      { err: error, userId: user.id },
      '[Discord Unlink] Confirmation failed'
    )
    throw Errors.internal('Failed to confirm Discord unlink')
  }
  const confirmation = parseDiscordUnlinkConfirmation(data, {
    unlinkId: state.unlinkId,
    generation: state.generation
  })
  if (!confirmation) throw Errors.conflict('Discord identity is still linked')
  const response = NextResponse.json({
    success: true,
    unlinkId: confirmation.unlinkId,
    generation: confirmation.generation,
    message: 'Discord identity unlink confirmed'
  })
  // Linking prepares a new generation, so this nonce is dead.
  response.cookies.delete(DISCORD_RELINK_STATE_COOKIE)
  return response
})

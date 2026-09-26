import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.invite-code')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  requireSessionUser,
  resolveCurrentMembership
} from '@/app/lib/api/session-user'
import {
  createPlayerInviteCode,
  listPlayerInviteCodes,
  revokePlayerInviteCode
} from '@/app/lib/auth/player-authority-lifecycle'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { throwInviteRpcFailure } from '@/app/lib/auth/invite-code-errors'

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Unauthorized' })
    )

    const body = await request.json()
    const { player_id, display_name, guild_code, expires_hours = 72 } = body

    if (!player_id || !guild_code) {
      throw Errors.fromResponse(400, {
        error: 'Missing required fields: player_id, guild_code'
      })
    }

    const userMapping = await resolveCurrentMembership(supabase, user.id)

    if (!userMapping) {
      throw Errors.fromResponse(403, { error: 'User profile not found' })
    }

    if (userMapping.guild_code !== guild_code) {
      throw Errors.fromResponse(403, {
        error: 'Cannot create invite codes for other guilds'
      })
    }

    if (!canManageHeraldRole(userMapping.role)) {
      throw Errors.fromResponse(403, {
        error: 'Only guild leaders and officers can generate invite codes'
      })
    }

    const { data: existingPlayer, error: playerError } = await guildRosterQuery(
      serviceDb(),
      guild_code,
      'id, player_id, user_id, display_name'
    )
      .eq('player_id', player_id)
      .single()

    if (playerError || !existingPlayer) {
      throw Errors.fromResponse(404, { error: 'Player not found in guild' })
    }

    if (existingPlayer.user_id) {
      throw Errors.fromResponse(400, {
        error: 'This player has already claimed their profile'
      })
    }

    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + expires_hours)
    const { data: inviteData, error: insertError } =
      await createPlayerInviteCode(
        supabase,
        existingPlayer.id,
        expiresAt.toISOString()
      )
    const invite = inviteData as {
      success?: boolean
      code?: string
      expires_at?: string
      player_name?: string
    } | null
    if (insertError || invite?.success !== true) {
      logger.error({ error: insertError }, 'Failed to create invite code')
      throwInviteRpcFailure(
        inviteData,
        insertError,
        'Failed to create invite code'
      )
    }
    if (
      typeof invite.code !== 'string' ||
      typeof invite.expires_at !== 'string'
    ) {
      throw Errors.fromResponse(500, { error: 'Invalid invite-code response' })
    }

    return NextResponse.json({
      success: true,
      code: invite.code,
      expires_at: invite.expires_at,
      player_name:
        invite.player_name || display_name || existingPlayer.display_name
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Invite code generation error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Unauthorized' })
    )

    const { searchParams } = new URL(request.url)
    const guildCode = searchParams.get('guild_code')

    if (!guildCode) {
      throw Errors.fromResponse(400, { error: 'guild_code is required' })
    }

    const { data: userMapping, error: mappingError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('role, guild_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .single()

    if (mappingError || !userMapping) {
      throw Errors.fromResponse(403, { error: 'User profile not found' })
    }

    if (userMapping.guild_code !== guildCode) {
      throw Errors.fromResponse(403, {
        error: 'Cannot view invite codes for other guilds'
      })
    }

    if (!canManageHeraldRole(userMapping.role)) {
      throw Errors.fromResponse(403, { error: 'Insufficient permissions' })
    }

    const { data: codes, error: fetchError } = await listPlayerInviteCodes(
      supabase,
      guildCode
    )

    if (fetchError) {
      logger.error({ error: fetchError }, 'Failed to fetch invite codes')
      throwInviteRpcFailure(null, fetchError, 'Failed to fetch codes')
    }
    if (!Array.isArray(codes)) {
      throw Errors.fromResponse(500, { error: 'Invalid invite-code response' })
    }

    return NextResponse.json({ codes })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Invite code fetch error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()

    await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Unauthorized' })
    )

    const { searchParams } = new URL(request.url)
    const codeId = searchParams.get('id')

    if (!codeId) {
      throw Errors.fromResponse(400, { error: 'Code ID is required' })
    }

    const { data, error: updateError } = await revokePlayerInviteCode(
      supabase,
      codeId,
      'officer_revoked'
    )
    if (
      updateError ||
      !data ||
      typeof data !== 'object' ||
      (data as { success?: boolean }).success !== true
    ) {
      logger.error({ error: updateError }, 'Failed to revoke invite code')
      throwInviteRpcFailure(data, updateError, 'Failed to revoke code')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Invite code revoke error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

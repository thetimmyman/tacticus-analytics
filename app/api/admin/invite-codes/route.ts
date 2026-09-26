import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.admin.invite-codes')
import { rethrowIfAuthError } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  createPlayerInviteCode,
  listPlayerInviteCodes,
  revokePlayerInviteCode
} from '@/app/lib/auth/player-authority-lifecycle'
import { throwInviteRpcFailure } from '@/app/lib/auth/invite-code-errors'

const LEGACY_ADMIN_DENIED_METADATA = { error: 'Admin access required' }

export const GET = withAdminGuards(
  {
    guard: 'app-admin',
    deniedMetadata: LEGACY_ADMIN_DENIED_METADATA
  },
  async (request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url)
      const guildCode = searchParams.get('guild_code')

      const supabase = await db()
      const { data: codes, error } = await listPlayerInviteCodes(
        supabase,
        guildCode
      )

      if (error) {
        logger.error({ error }, 'Failed to fetch invite codes')
        throwInviteRpcFailure(null, error, 'Failed to fetch invite codes')
      }
      if (!Array.isArray(codes)) {
        throw Errors.fromResponse(500, {
          error: 'Invalid invite-code response'
        })
      }

      return NextResponse.json({ codes })
    } catch (err) {
      rethrowIfAppError(err)
      rethrowIfAuthError(err)
      logger.error({ error: err }, 'Admin invite code fetch error')
      throw Errors.fromResponse(500, {
        error: err instanceof Error ? err.message : 'Internal error'
      })
    }
  }
)

export const POST = withAdminGuards(
  {
    guard: 'app-admin',
    deniedMetadata: LEGACY_ADMIN_DENIED_METADATA
  },
  async (request: NextRequest, _context, { user }) => {
    try {
      const body = await request.json()
      const { player_id, display_name, guild_code, expires_hours = 168 } = body

      if (!player_id || !guild_code) {
        throw Errors.fromResponse(400, {
          error: 'Missing required fields: player_id, guild_code'
        })
      }

      const supabase = serviceDb()

      const { data: existingPlayer, error: playerError } =
        await guildRosterQuery(
          supabase,
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
      const authedSupabase = await db()
      const { data: inviteData, error: insertError } =
        await createPlayerInviteCode(
          authedSupabase,
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
        throw Errors.fromResponse(500, {
          error: 'Invalid invite-code response'
        })
      }

      // Never log the plaintext code (it grants guild access).
      logger.info(
        {
          admin_id: user.id,
          player_id,
          guild_code,
          code_suffix: invite.code.slice(-4)
        },
        'Admin created invite code'
      )

      return NextResponse.json({
        success: true,
        code: invite.code,
        expires_at: invite.expires_at,
        player_name:
          invite.player_name || display_name || existingPlayer.display_name
      })
    } catch (err) {
      rethrowIfAppError(err)
      rethrowIfAuthError(err)
      logger.error({ error: err }, 'Admin invite code creation error')
      throw Errors.fromResponse(500, {
        error: err instanceof Error ? err.message : 'Internal error'
      })
    }
  }
)

export const DELETE = withAdminGuards(
  {
    guard: 'app-admin',
    deniedMetadata: LEGACY_ADMIN_DENIED_METADATA
  },
  async (request: NextRequest, _context, { user }) => {
    try {
      const { searchParams } = new URL(request.url)
      const codeId = searchParams.get('id')

      if (!codeId) {
        throw Errors.fromResponse(400, { error: 'Code ID is required' })
      }

      const supabase = await db()
      const { data, error: updateError } = await revokePlayerInviteCode(
        supabase,
        codeId,
        'admin_revoked'
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

      logger.info(
        { admin_id: user.id, code_id: codeId },
        'Admin revoked invite code'
      )

      return NextResponse.json({ success: true })
    } catch (err) {
      rethrowIfAppError(err)
      rethrowIfAuthError(err)
      logger.error({ error: err }, 'Admin invite code revoke error')
      throw Errors.fromResponse(500, {
        error: err instanceof Error ? err.message : 'Internal error'
      })
    }
  }
)

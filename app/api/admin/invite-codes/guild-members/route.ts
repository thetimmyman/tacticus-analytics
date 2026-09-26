import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { rethrowIfAuthError } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { listActivePlayerInviteCodes } from '@/app/lib/auth/player-authority-lifecycle'
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

      if (!guildCode) {
        throw Errors.fromResponse(400, { error: 'guild_code is required' })
      }

      const supabase = serviceDb()

      const { data: members, error } = await guildRosterQuery(
        supabase,
        guildCode,
        'player_id, display_name, role, user_id'
      )
        .order('role', { ascending: true })
        .order('display_name', { ascending: true })

      if (error) {
        throw Errors.fromResponse(500, { error: error.message })
      }

      const authedSupabase = await db()
      const { data: inviteRows, error: inviteError } =
        await listActivePlayerInviteCodes(authedSupabase, guildCode)
      if (inviteError) {
        throwInviteRpcFailure(null, inviteError, 'Failed to fetch invite codes')
      }
      if (!Array.isArray(inviteRows)) {
        throw Errors.fromResponse(500, {
          error: 'Invalid invite-code response'
        })
      }

      const activeCodeMap = new Map<
        string,
        { code: string; expires_at: string }
      >()
      for (const row of inviteRows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw Errors.fromResponse(500, {
            error: 'Invalid invite-code response'
          })
        }
        const invite = row as Record<string, unknown>
        if (
          typeof invite.player_id !== 'string' ||
          invite.player_id.length === 0 ||
          typeof invite.code !== 'string' ||
          invite.code.length === 0 ||
          typeof invite.expires_at !== 'string' ||
          !Number.isFinite(Date.parse(invite.expires_at))
        ) {
          throw Errors.fromResponse(500, {
            error: 'Invalid invite-code response'
          })
        }
        // Newest active invite first; keep it when historical duplicates left several.
        if (!activeCodeMap.has(invite.player_id)) {
          activeCodeMap.set(invite.player_id, {
            code: invite.code,
            expires_at: invite.expires_at
          })
        }
      }

      const result = (members || []).map((m) => ({
        player_id: m.player_id,
        display_name: m.display_name,
        role: m.role,
        has_account: !!m.user_id,
        active_invite_code: activeCodeMap.get(m.player_id) || null
      }))

      return NextResponse.json({ members: result })
    } catch (err) {
      rethrowIfAppError(err)
      rethrowIfAuthError(err)
      throw Errors.fromResponse(500, {
        error: err instanceof Error ? err.message : 'Internal error'
      })
    }
  }
)

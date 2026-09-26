import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireGuildMember } from '@/app/lib/auth/guild-permissions'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'

const logger = createComponentLogger('player-meta-roles')

// Only 'self' and 'leader_override' are writable here; the reconciler's 'auto' never overrides a human.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface WriteInput {
  user_id: string
  meta_team_id: string
  source: 'self' | 'leader_override'
}

const normalizeWriteInput = (body: unknown): WriteInput | null => {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  const userId =
    typeof obj.user_id === 'string' ? obj.user_id.trim().toLowerCase() : ''
  const teamId =
    typeof obj.meta_team_id === 'string'
      ? obj.meta_team_id.trim().toLowerCase()
      : ''
  const source = obj.source
  if (!UUID_REGEX.test(userId) || !UUID_REGEX.test(teamId)) return null
  if (source !== 'self' && source !== 'leader_override') return null
  return { user_id: userId, meta_team_id: teamId, source }
}

// A peer guild's cluster leader may read.
export const GET = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/player-meta-roles'
    })
  )

  const url = new URL(req.url)
  const guildCode = url.searchParams.get('guild_code')?.trim() ?? ''
  if (!guildCode) {
    throw Errors.validation('guild_code is required', {
      endpoint: '/api/player-meta-roles'
    })
  }

  await requireGuildMember(
    supabase,
    user.id,
    guildCode,
    '/api/player-meta-roles'
  )

  // A join filter through player_mapping would need a view or definer function.
  const { data: members, error: membersErr } = await guildRosterQuery(
    serviceDb(),
    guildCode,
    'user_id'
  )
  if (membersErr) {
    throw Errors.fetchFailed('Failed to load guild members', {
      endpoint: '/api/player-meta-roles',
      details: membersErr.message
    })
  }
  const memberUserIds = (members ?? [])
    .map((m) => (m as { user_id: string | null }).user_id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  if (memberUserIds.length === 0) {
    return NextResponse.json({ success: true, rows: [] })
  }

  const { data, error } = await supabase
    .from('player_meta_roles')
    .select('id, user_id, meta_team_id, source, set_by, created_at, updated_at')
    .in('user_id', memberUserIds)
  if (error) {
    throw Errors.fetchFailed('Failed to load player meta roles', {
      endpoint: '/api/player-meta-roles',
      details: error.message
    })
  }

  return NextResponse.json({ success: true, rows: data ?? [] })
})

// 'self' requires user_id = caller; 'leader_override' requires officer/leader of the target's guild.
export const POST = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/player-meta-roles'
    })
  )

  const body = await req.json().catch(() => null)
  const input = normalizeWriteInput(body)
  if (!input) {
    throw Errors.validation(
      "user_id (uuid), meta_team_id (uuid), and source ('self' or 'leader_override') are required",
      { endpoint: '/api/player-meta-roles' }
    )
  }

  if (input.source === 'self') {
    if (input.user_id !== user.id) {
      throw Errors.forbidden(
        'Cannot write a self-source row for another user',
        {
          endpoint: '/api/player-meta-roles'
        }
      )
    }
  } else {
    // Peer-guild cluster leaders are deliberately not granted cross-guild overrides.
    const { data: callerProfile, error: callerErr } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('role, guild_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()
    if (callerErr) {
      throw Errors.internal('Failed to verify caller permissions', {
        endpoint: '/api/player-meta-roles',
        details: callerErr.message
      })
    }
    if (!callerProfile || !canManageHeraldRole(callerProfile.role)) {
      throw Errors.forbidden(
        'Officer or leader role required for leader_override writes',
        {
          endpoint: '/api/player-meta-roles'
        }
      )
    }
    const { data: targetProfile, error: targetErr } = await serviceDb()
      .from('player_mapping')
      .select('guild_code')
      .eq('user_id', input.user_id)
      .eq('is_current', true)
      .maybeSingle()
    if (targetErr) {
      throw Errors.internal('Failed to look up target user guild', {
        endpoint: '/api/player-meta-roles',
        details: targetErr.message
      })
    }
    if (
      !targetProfile ||
      targetProfile.guild_code !== callerProfile.guild_code
    ) {
      throw Errors.forbidden('Target user is not in your guild', {
        endpoint: '/api/player-meta-roles'
      })
    }
  }

  try {
    const writePayload = {
      user_id: input.user_id,
      meta_team_id: input.meta_team_id,
      source: input.source,
      set_by: user.id,
      updated_at: new Date().toISOString()
    }
    const { data, error } = await supabase
      .from('player_meta_roles')
      .upsert(writePayload, { onConflict: 'user_id,meta_team_id' })
      .select()
      .single()
    if (error) {
      logger.error({ err: error }, 'Error saving player meta role')
      throw Errors.updateFailed('Failed to save player meta role', {
        endpoint: '/api/player-meta-roles',
        details: error.message
      })
    }
    return NextResponse.json({ success: true, row: data })
  } catch (err) {
    rethrowIfAppError(err)
    throw err
  }
})

// The route check gives a 403 instead of "0 rows affected".
export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/player-meta-roles'
    })
  )

  const url = new URL(req.url)
  const targetUserId =
    url.searchParams.get('user_id')?.trim().toLowerCase() ?? ''
  const teamId =
    url.searchParams.get('meta_team_id')?.trim().toLowerCase() ?? ''
  const source = url.searchParams.get('source') ?? ''
  if (!UUID_REGEX.test(targetUserId) || !UUID_REGEX.test(teamId)) {
    throw Errors.validation(
      'user_id (uuid) and meta_team_id (uuid) are required',
      {
        endpoint: '/api/player-meta-roles'
      }
    )
  }
  if (source !== 'self' && source !== 'leader_override') {
    throw Errors.validation("source must be 'self' or 'leader_override'", {
      endpoint: '/api/player-meta-roles'
    })
  }

  if (source === 'self') {
    if (targetUserId !== user.id) {
      throw Errors.forbidden(
        'Cannot delete a self-source row for another user',
        {
          endpoint: '/api/player-meta-roles'
        }
      )
    }
  } else {
    const { data: callerProfile } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('role, guild_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()
    if (!callerProfile || !canManageHeraldRole(callerProfile.role)) {
      throw Errors.forbidden(
        'Officer or leader role required for leader_override deletes',
        {
          endpoint: '/api/player-meta-roles'
        }
      )
    }
    const { data: targetProfile } = await serviceDb()
      .from('player_mapping')
      .select('guild_code')
      .eq('user_id', targetUserId)
      .eq('is_current', true)
      .maybeSingle()
    if (
      !targetProfile ||
      targetProfile.guild_code !== callerProfile.guild_code
    ) {
      throw Errors.forbidden('Target user is not in your guild', {
        endpoint: '/api/player-meta-roles'
      })
    }
  }

  const { error } = await supabase
    .from('player_meta_roles')
    .delete()
    .eq('user_id', targetUserId)
    .eq('meta_team_id', teamId)
    .eq('source', source)

  if (error) {
    throw Errors.updateFailed('Failed to delete player meta role', {
      endpoint: '/api/player-meta-roles',
      details: error.message
    })
  }

  return NextResponse.json({ success: true })
})

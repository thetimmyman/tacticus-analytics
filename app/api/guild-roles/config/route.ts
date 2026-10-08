import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  requireGuildMember,
  requireGuildOfficerOrClusterLeader
} from '@/app/lib/auth/guild-permissions'

const logger = createComponentLogger('api.guild-roles.config')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENDPOINT = '/api/guild-roles/config'

// GET: any guild member. POST: officer or cluster leader.

const VALID_TIERS = new Set(['optimal', 'strong', 'suitable'])

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url)
    const guildCode = searchParams.get('guild_code')
    if (!guildCode) {
      throw Errors.validation('guild_code query param is required', {
        endpoint: ENDPOINT
      })
    }

    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.authenticationRequired('Authentication required', {
        endpoint: ENDPOINT
      })
    )

    await requireGuildMember(supabase, user.id, guildCode, ENDPOINT)

    const { data, error } = await supabase
      .from('guild_roster_scoring_config')
      .select('auto_role_assign_enabled, auto_role_assign_tier')
      .eq('guild_code', guildCode)
      .maybeSingle()

    if (error) {
      logger.warn(
        { guildCode, error: error.message },
        'config.get.query_failed'
      )
    }

    // No row = defaults.
    return NextResponse.json({
      auto_role_assign_enabled:
        (data as { auto_role_assign_enabled?: boolean } | null)
          ?.auto_role_assign_enabled ?? false,
      auto_role_assign_tier:
        (data as { auto_role_assign_tier?: string } | null)
          ?.auto_role_assign_tier ?? 'strong'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'config.get.error')
    throw Errors.fromResponse(500, {
      error: 'Internal server error'
    })
  }
})

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => null)) as {
      guild_code?: string
      auto_role_assign_enabled?: boolean
      auto_role_assign_tier?: string
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

    const update: {
      guild_code: string
      updated_at: string
      auto_role_assign_enabled?: boolean
      auto_role_assign_tier?: string
    } = {
      guild_code: body.guild_code,
      updated_at: new Date().toISOString()
    }
    if (typeof body.auto_role_assign_enabled === 'boolean') {
      update.auto_role_assign_enabled = body.auto_role_assign_enabled
    }
    if (typeof body.auto_role_assign_tier === 'string') {
      if (!VALID_TIERS.has(body.auto_role_assign_tier)) {
        throw Errors.validation(
          'auto_role_assign_tier must be one of: optimal, strong, suitable',
          { endpoint: ENDPOINT }
        )
      }
      update.auto_role_assign_tier = body.auto_role_assign_tier
    }

    // Authorized above; no RLS write policy admits the session client.
    const service = serviceDb()
    const { data, error } = await service
      .from('guild_roster_scoring_config')
      .upsert(update, { onConflict: 'guild_code' })
      .select('auto_role_assign_enabled, auto_role_assign_tier')
      .single()

    if (error) {
      logger.error(
        { guildCode: body.guild_code, error: error.message },
        'config.post.upsert_failed'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to save config'
      })
    }

    const typedData = data as {
      auto_role_assign_enabled?: boolean
      auto_role_assign_tier?: string
    } | null

    logger.info(
      {
        guildCode: body.guild_code,
        auto_role_assign_enabled: typedData?.auto_role_assign_enabled,
        auto_role_assign_tier: typedData?.auto_role_assign_tier
      },
      'config.post.saved'
    )

    return NextResponse.json({ success: true, config: typedData })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'config.post.error')
    throw Errors.fromResponse(500, {
      error: 'Internal server error'
    })
  }
})

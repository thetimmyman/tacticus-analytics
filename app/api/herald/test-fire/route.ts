import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import {
  postHeraldTestMessage,
  type TestFireKind
} from '@/app/lib/herald/engine'

const logger = createComponentLogger('herald-test-fire')

// Checks channel, role and links config without waiting for a real boss kill.

const BOSS_ID_REGEX = /^[A-Za-z][A-Za-z0-9]*_E\d{1,3}$/

export const POST = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/test-fire'
    })
  )

  const body = await req.json().catch(() => null)
  const obj = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >
  const guildCode =
    typeof obj.guild_code === 'string' ? obj.guild_code.trim() : ''
  const bossId = typeof obj.boss_id === 'string' ? obj.boss_id.trim() : ''
  const bossName =
    typeof obj.boss_display_name === 'string' &&
    obj.boss_display_name.trim().length > 0
      ? obj.boss_display_name.trim().slice(0, 80)
      : null
  const rarity =
    typeof obj.rarity === 'string' ? obj.rarity.trim() : 'Legendary'
  const kindRaw = typeof obj.kind === 'string' ? obj.kind.trim() : 'defeat'
  const kind: TestFireKind =
    kindRaw === 'availability' ? 'availability' : 'defeat'

  if (!guildCode || !bossId) {
    throw Errors.validation('guild_code and boss_id are required', {
      endpoint: '/api/herald/test-fire'
    })
  }
  if (!BOSS_ID_REGEX.test(bossId)) {
    throw Errors.validation('boss_id must be in <BossType>_E<n> format', {
      endpoint: '/api/herald/test-fire'
    })
  }

  const profile = await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    guildCode,
    '/api/herald/test-fire'
  )

  const invocationId = randomUUID()
  try {
    // Service role, like the real sync, so RLS cannot silently drop config rows.
    const service = serviceDb()
    const result = await postHeraldTestMessage({
      supabase: service,
      guildCode,
      bossId,
      bossDisplayName: bossName ?? bossId.replace(/_E\d+$/, ''),
      rarity,
      kind,
      invocationId,
      actorDisplayName: profile.display_name ?? null
    })

    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: bossId,
        kind,
        ...result
      },
      'herald.test_fire.result'
    )

    return NextResponse.json({
      success: result.posted > 0,
      invocation_id: invocationId,
      ...result
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      {
        err: error,
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: bossId
      },
      'Herald test-fire failed'
    )
    throw Errors.internal('Herald test-fire failed', {
      endpoint: '/api/herald/test-fire',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

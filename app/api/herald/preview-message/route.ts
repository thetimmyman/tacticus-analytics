import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import {
  composeHeraldPreview,
  type TestFireKind,
  type HeraldPrimeState
} from '@/app/lib/herald/engine'

const VALID_PRIME_STATES: ReadonlySet<HeraldPrimeState> = new Set([
  'both_alive',
  'left_dead',
  'right_dead',
  'both_dead'
])
const parsePrimeState = (raw: unknown): HeraldPrimeState | undefined => {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim() as HeraldPrimeState
  return VALID_PRIME_STATES.has(trimmed) ? trimmed : undefined
}

const logger = createComponentLogger('preview-message')

// Never posts or touches dedup tables. Officer/cluster-leader gated (role IDs).

const BOSS_ID_REGEX = /^[A-Za-z][A-Za-z0-9]*_E\d{1,3}$/

export const POST = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/preview-message'
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
  const kindRaw =
    typeof obj.kind === 'string' ? obj.kind.trim() : 'availability'
  const kind: TestFireKind = kindRaw === 'defeat' ? 'defeat' : 'availability'
  const primeState = parsePrimeState(obj.prime_state)

  if (!guildCode || !bossId) {
    throw Errors.validation('guild_code and boss_id are required', {
      endpoint: '/api/herald/preview-message'
    })
  }
  if (!BOSS_ID_REGEX.test(bossId)) {
    throw Errors.validation('boss_id must be in <BossType>_E<n> format', {
      endpoint: '/api/herald/preview-message'
    })
  }

  const profile = await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    guildCode,
    '/api/herald/preview-message'
  )

  try {
    // Service role, as in test-fire, so the preview matches what would fire.
    const service = serviceDb()
    const result = await composeHeraldPreview({
      supabase: service,
      guildCode,
      bossId,
      bossDisplayName: bossName ?? bossId.replace(/_E\d+$/, ''),
      rarity,
      kind,
      actorDisplayName: profile.display_name ?? null,
      primeState
    })

    return NextResponse.json({
      payload: result.payload,
      role_ids: result.roleIds,
      role_ping_count: result.roleIds.length,
      embed_used: result.embedUsed,
      scope: result.scope,
      prime_state: primeState ?? null
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      {
        err: error,
        guild_code: guildCode,
        boss_id: bossId
      },
      'Herald preview-message failed'
    )
    throw Errors.internal('Herald preview-message failed', {
      endpoint: '/api/herald/preview-message',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

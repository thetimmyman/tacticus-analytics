import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { postHeraldManualOverride } from '@/app/lib/herald/engine'
import {
  DEDUP_WINDOW_MS,
  MAIN_BOSS_ID_REGEX,
  computePrimeBossId,
  parsePrime
} from '@/app/lib/herald/trigger-notification'

const logger = createComponentLogger('herald-trigger-notification')

// Fires a prime notification now. Deduped per (guild, prime_boss_id, 30s); a repeat returns 409.

const ENDPOINT = '/api/herald/trigger-notification'

// `includes` so older prefixed rows still match.
const findRecentOverride = async (
  service: ReturnType<typeof serviceDb>,
  guildCode: string,
  primeBossId: string,
  nowMs: number
): Promise<{ createdAtMs: number } | null> => {
  const sinceIso = new Date(nowMs - DEDUP_WINDOW_MS).toISOString()
  const { data, error } = await service
    .from('discord_webhook_logs')
    .select('created_at, payload_preview')
    .eq('guild_code', guildCode)
    .eq('manual_override', true)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    // Fail open: a dedup read error must not block an officer override.
    logger.warn(
      { err: error.message, guild_code: guildCode },
      'herald.trigger_notification.dedup_read_failed'
    )
    return null
  }
  if (!Array.isArray(data)) return null

  for (const row of data) {
    const preview =
      typeof row.payload_preview === 'string' ? row.payload_preview : ''
    if (!preview.includes(primeBossId)) continue
    const createdAt = row.created_at ? Date.parse(row.created_at) : NaN
    if (!Number.isFinite(createdAt)) continue
    return { createdAtMs: createdAt }
  }
  return null
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: ENDPOINT
    })
  )

  const body = await req.json().catch(() => null)
  const obj = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >
  const guildCode =
    typeof obj.guild_code === 'string' ? obj.guild_code.trim() : ''
  const mainBossId =
    typeof obj.main_boss_id === 'string' ? obj.main_boss_id.trim() : ''
  const mainBossName =
    typeof obj.boss_display_name === 'string' &&
    obj.boss_display_name.trim().length > 0
      ? obj.boss_display_name.trim().slice(0, 80)
      : null
  const rarity =
    typeof obj.rarity === 'string' ? obj.rarity.trim() : 'Legendary'
  const prime = parsePrime(obj.prime)

  if (!guildCode || !mainBossId) {
    throw Errors.validation('guild_code and main_boss_id are required', {
      endpoint: ENDPOINT
    })
  }
  if (!MAIN_BOSS_ID_REGEX.test(mainBossId)) {
    throw Errors.validation(
      'main_boss_id must be in <BossType>_E0 format (main encounter)',
      {
        endpoint: ENDPOINT
      }
    )
  }
  if (!prime) {
    throw Errors.validation("prime must be 'a' or 'b'", {
      endpoint: ENDPOINT
    })
  }

  const profile = await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    guildCode,
    ENDPOINT
  )

  const invocationId = randomUUID()
  const primeBossId = computePrimeBossId(mainBossId, prime)
  const nowMs = Date.now()

  // Service role so RLS cannot silently drop the dedup rows.
  const service = serviceDb()

  const recent = await findRecentOverride(
    service,
    guildCode,
    primeBossId,
    nowMs
  )
  if (recent) {
    const elapsedMs = nowMs - recent.createdAtMs
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((DEDUP_WINDOW_MS - elapsedMs) / 1000)
    )
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        main_boss_id: mainBossId,
        prime_boss_id: primeBossId,
        prime,
        elapsed_ms: elapsedMs
      },
      'herald.trigger_notification.dedup_block'
    )
    // Built directly so Retry-After survives (withErrorHandler drops custom headers).
    return NextResponse.json(
      {
        error: {
          code: 3003,
          message: 'duplicate_override_request',
          metadata: {
            retry_after_seconds: retryAfterSeconds,
            invocation_id: invocationId,
            prime,
            prime_boss_id: primeBossId
          }
        },
        retry_after_seconds: retryAfterSeconds,
        invocation_id: invocationId
      },
      { status: 409, headers: { 'Retry-After': String(retryAfterSeconds) } }
    )
  }

  try {
    const result = await postHeraldManualOverride({
      supabase: service,
      guildCode,
      mainBossId,
      mainBossDisplayName: mainBossName ?? mainBossId.replace(/_E0$/, ''),
      rarity,
      prime,
      invocationId,
      actorDisplayName: profile.display_name ?? null
    })

    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        main_boss_id: mainBossId,
        prime,
        ...result
      },
      'herald.trigger_notification.result'
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
        main_boss_id: mainBossId,
        prime
      },
      'Herald trigger-notification failed'
    )
    throw Errors.internal('Herald trigger-notification failed', {
      endpoint: ENDPOINT,
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

/** Advances the cutoff to the render-time snapshot, not POST time (which could skip deltas). */

import { db } from '@/app/lib/db'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'

export const POST = withErrorHandler(async (request: Request) => {
  const { user, profile } = await requireActiveMembershipForApi()
  const guildCode = profile.guild_code
  if (!guildCode) {
    return Response.json({ ok: true, skipped: 'no_guild' })
  }

  let snapshotAt: string | null = null
  try {
    const body = (await request.json()) as { snapshotAt?: string }
    snapshotAt = body?.snapshotAt ?? null
  } catch {
    snapshotAt = null
  }
  if (!snapshotAt || Number.isNaN(Date.parse(snapshotAt))) {
    throw Errors.fromResponse(400, {
      error: 'snapshotAt (ISO timestamp) required'
    })
  }

  const sb = await db()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any
  const { error } = await sbAny.from('user_briefing_state').upsert(
    {
      user_id: user.id,
      guild_code: guildCode,
      previous_cutoff_at: snapshotAt,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,guild_code' }
  )
  if (error) {
    throw Errors.fromResponse(500, {
      error: 'Failed to advance briefing cutoff'
    })
  }

  return Response.json({ ok: true })
})

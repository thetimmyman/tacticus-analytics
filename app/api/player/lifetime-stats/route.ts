import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import {
  requireSessionUser,
  resolveCurrentMembership
} from '@/app/lib/api/session-user'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async () => {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('Authentication required')
  )

  const mapping = await resolveCurrentMembership(supabase, user.id)

  if (!mapping?.player_id) {
    return NextResponse.json({
      seasonsParticipated: 0,
      lordsFelled: 0,
      bestDamage: null,
      submissionCount: 0,
      guildWarsParticipated: 0
    })
  }

  const playerId = mapping.player_id

  const [seasonsRes, killsRes, bestDmgRes, submissionsRes, warsRes] =
    await Promise.all([
      supabase
        .from('EOT_GR_data')
        .select('Season', { count: 'exact', head: false })
        .eq('userId', playerId)
        .not('Season', 'is', null)
        .order('startedOn', { ascending: false }),

      supabase
        .from('EOT_GR_data')
        .select('id', { count: 'exact', head: true })
        .eq('userId', playerId)
        .eq('remainingHp', 0),

      supabase
        .from('EOT_GR_data')
        .select('damageDealt, Name')
        .eq('userId', playerId)
        .not('damageDealt', 'is', null)
        .order('damageDealt', { ascending: false })
        .limit(1),

      supabase
        .from('EOT_GR_data')
        .select('id', { count: 'exact', head: true })
        .eq('userId', playerId),

      supabase
        .from('guild_war_player_attempts')
        .select('war_id')
        .eq('player_id', playerId)
    ])

  const uniqueSeasons = new Set((seasonsRes.data ?? []).map((r) => r.Season))
    .size

  const uniqueWars = new Set((warsRes.data ?? []).map((r) => r.war_id)).size

  const bestRow = bestDmgRes.data?.[0] ?? null

  return NextResponse.json({
    seasonsParticipated: uniqueSeasons,
    lordsFelled: killsRes.count ?? 0,
    bestDamage: bestRow
      ? { damage: bestRow.damageDealt, bossName: bestRow.Name }
      : null,
    submissionCount: submissionsRes.count ?? 0,
    guildWarsParticipated: uniqueWars
  })
})

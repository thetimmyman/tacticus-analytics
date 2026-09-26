/** 1.0-centred target-weighted scores per (season, player) for the Guild Trends heatmap. */

import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { getTargetScoresBatch } from '@/app/lib/guild-trends/target-scores-batch'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  // A warm cache must never let an inactive former member skip the membership check.
  const { profile } = await requireActiveMembershipForApi()

  const searchParams = request.nextUrl.searchParams
  const profileGuildCode = profile?.guild_code || ''
  const guildCode = searchParams.get('guild') || profileGuildCode
  if (!guildCode || !profileGuildCode) {
    return NextResponse.json({ error: 'Missing guild code' }, { status: 400 })
  }

  const normalizedGuildCode = GuildConfigService.normalizeCode(guildCode)
  if (
    GuildConfigService.normalizeCode(profileGuildCode) !== normalizedGuildCode
  ) {
    return NextResponse.json(
      { error: 'Access denied for requested guild' },
      { status: 403 }
    )
  }

  const seasons = (searchParams.get('seasons') || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (seasons.length === 0) {
    return NextResponse.json({ rows: [] })
  }

  const rows = await getTargetScoresBatch(normalizedGuildCode, seasons)
  return NextResponse.json({ rows })
})

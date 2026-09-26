import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { requireTokenUsageGuildAccess } from '@/app/api/members/token-usage/access'
import { computeSeasonOutlookDetailWithTimeout } from '@/app/lib/season-forecast/season-outlook-projection'
import { scopeOutlookPlayers } from '@/app/lib/season-forecast/outlook-player-scope'
import { getLatestSeason } from '@/app/lib/utils/season'

/** Both null on sim miss/timeout; `players` is the full roster for officers, else at most the caller's row. */

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const searchParams = new URL(request.url).searchParams
  const requestedGuild = searchParams.get('guildCode')
  const seasonParam = searchParams.get('season')?.trim() ?? ''
  const seasonNumber = Number.parseInt(seasonParam, 10)

  if (!requestedGuild || !Number.isFinite(seasonNumber) || seasonNumber <= 0) {
    throw Errors.fromResponse(400, {
      error: 'guildCode and season parameters required'
    })
  }

  // Member-level gate: the outlook is a member-safe aggregate; per-player rows are scoped below.
  const { guild, profile } = await requireTokenUsageGuildAccess(requestedGuild)

  // Past seasons must not run the expensive planner.
  const latestSeason = await getLatestSeason()
  if (!latestSeason || String(seasonNumber) !== latestSeason) {
    return NextResponse.json({ projection: null, players: null })
  }

  // Canonical guild_code so the cache key matches server callers; the 7s race bounds a cache-miss sim.
  const detail = await computeSeasonOutlookDetailWithTimeout({
    guildCode: guild,
    season: String(seasonNumber)
  })

  if (!detail) {
    return NextResponse.json({ projection: null, players: null })
  }

  // Privacy boundary: the cached detail holds the full roster. Role and player_id are DB-derived.
  const players = scopeOutlookPlayers({
    players: detail.players,
    role: profile.role,
    selfPlayerId: profile.player_id
  })

  return NextResponse.json({ projection: detail.projection, players })
})

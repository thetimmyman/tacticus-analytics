// Mirrors `get_guild_season_forecast`; no 'admin' branch, since matching it would be spoofable.

import type { PlayerTokenPaceRow } from '@/app/lib/season-forecast/season-token-economy'

export type OutlookPlayerScope = 'all' | 'self'

export function resolveOutlookPlayerScope(
  role: string | null | undefined
): OutlookPlayerScope {
  const normalizedRole = (role ?? '').toLowerCase()
  return normalizedRole === 'officer' || normalizedRole === 'leader'
    ? 'all'
    : 'self'
}

export function scopeOutlookPlayers(args: {
  players: PlayerTokenPaceRow[]
  role: string | null | undefined
  selfPlayerId: string | null | undefined
}): PlayerTokenPaceRow[] {
  if (resolveOutlookPlayerScope(args.role) === 'all') return args.players
  if (!args.selfPlayerId) return []
  return args.players.filter((row) => row.playerId === args.selfPlayerId)
}

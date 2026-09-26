/**
 * Who can see a player's stats page, derived from the real gates: the player
 * (`/player-stats`), and officers+ via `/guild-ops/player-lookup` for any guild in
 * their `cluster_code`. Keep in sync with those gates.
 */
export const PLAYER_STATS_AUDIENCE: readonly string[] = [
  'The player themselves',
  'Officers & leaders in their cluster'
] as const

export const PLAYER_STATS_AUDIENCE_FOOTNOTE =
  'Cluster-wide, not guild-only: any officer or leader of a guild in the same cluster can open this page.'

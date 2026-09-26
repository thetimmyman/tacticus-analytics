// Edge copy of the GW ranking policy: only supabase/functions is deployed, so
// the workspace package cannot be imported. Parity: tests/unit/sync/gw-ranking-policy.test.ts.
export const MAX_VALID_GUILD_RANKING = 10_000

export function buildGwSeasonsToTry(
  nowSeason: number,
  cachedSeason: number | null
): number[] {
  return [
    ...new Set(
      [
        nowSeason,
        nowSeason - 1,
        ...(cachedSeason ? [cachedSeason] : []),
        nowSeason - 2,
        nowSeason + 1
      ].filter((season) => season > 0)
    )
  ]
}

export function isPersistableGuildRanking(
  ranking: number | null
): ranking is number {
  return ranking !== null && ranking > 0 && ranking <= MAX_VALID_GUILD_RANKING
}

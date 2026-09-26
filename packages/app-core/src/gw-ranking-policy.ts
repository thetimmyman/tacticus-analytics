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

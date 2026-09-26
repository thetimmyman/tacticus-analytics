export const queryKeys = {
  fiveSeasonAverages: (guild: string, season: number) =>
    ['five-season-averages', guild, season] as const,
  rosterMembership: (guild: string) => ['roster-membership', guild] as const,
  tokenStats: (guild: string, season: number, includeCluster: boolean) =>
    ['token-stats', guild, season, includeCluster] as const,
  tokenBurnStats: (guild: string, season: string) =>
    ['token-burn-stats', guild, season] as const,
  targetWeightedTokenPerformance: (
    guild: string,
    season: string,
    compareMode: string,
    clusterCode: string,
    rarities: string,
    includePrimes: boolean
  ) =>
    [
      'target-weighted-token-performance',
      guild,
      season,
      compareMode,
      clusterCode,
      rarities,
      includePrimes
    ] as const
}

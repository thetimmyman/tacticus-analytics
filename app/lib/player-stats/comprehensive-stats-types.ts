interface BossStatEntry {
  damage: number
  tokens: number
  avgDamage: number
  biggestHit: number
  sweeps: number
  oneShots: number
  crashes: number
  totalTokens: number
  totalDamageWithSweeps: number
  avgDamageWithSweeps: number
  /** 1-based. */
  set: number
  /** 1-based within the set. */
  tier: number
  rarity: string
  encounterId: number
  /** Ratio. */
  vsGuildAvg: number
  /** Ratio. */
  vsClusterAvg: number
}

export interface ComprehensivePlayerStats {
  totalDamage: number
  avgDamagePerHit: number
  tokensUsed: number
  bombsUsed: number
  legendaryTokensUsed: number
  legendaryBombsUsed: number
  maxPossibleTokens: number
  maxPossibleBombs: number
  isTokenOffender: boolean
  isTokenAbuser: boolean
  kills: number
  sweeps: number
  oneShots: number
  crashes: number
  vsClusterAvg: number
  vsGuildAvg: number
  weightedContribution: number
  bossStats: Record<string, BossStatEntry>
  primeStats: Record<string, BossStatEntry>
  historicalTokens: Record<string, number>
}

export interface BossCombatMetrics {
  currentLoopIndex: number | null
  currentBattleCount: number | null
  currentElapsedMs: number | null
  previousLoopDurationMs: number | null
  previousLoopTokens: number | null
  averageTokensToKill: number | null
  averageDamagePerHit: number | null
  playerAverageDamagePerHit?: number | null
}

export interface LandingPageGuildStats {
  currentRank: number | null
  currentWarRank: number | null
  recentActivity: number
  totalDamage: number
  activePlayers: number
  completedLoops: number
  avgDamagePerHit: number
  maxHit: number
  bossKills: number
  avgDamagePerHour: number | null
}

export interface LandingPagePersonalStats {
  guildRank: number | null
  clusterRank: number | null
  avgDamagePerHit: number | null
  maxHit: number | null
  tokensUsed: number | null
  totalTokens: number
  vsGuildPct: number | null
  vsClusterPct: number | null
}

export interface LandingPageBossOverview {
  name: string
  displayName: string
  rarity: 'Legendary' | 'Mythic'
  levelCode: string
  loop: number | null
  maxHp: number
  remainingHp: number
  hpPercentage: number
  formattedMaxHp: string
  formattedRemainingHp: string
  encounterId: number
  combatMetrics?: BossCombatMetrics
}

export interface LandingPageManagementData {
  topPerformers: Array<{ name: string; vsGuildPct: number; rank: number }>
  bottomPerformers: Array<{ name: string; vsGuildPct: number; rank: number }>
  topTokenUsers: Array<{
    name: string
    tokens: string
    percentage: number
    rank: number
  }>
  bottomTokenUsers: Array<{
    name: string
    tokens: string
    percentage: number
    rank: number
  }>
}

export interface CredentialHealthSummary {
  playerApiKey: 'healthy' | 'warning' | 'error' | 'missing'
  guildApiKeys: 'healthy' | 'warning' | 'error' | 'missing'
  discordWebhooks: 'healthy' | 'warning' | 'error' | 'missing'
  profileCompletion: number
}

export interface TokenStatus {
  current: number
  max: number
  nextInSeconds: number | null
}

export interface TokenData {
  guildRaid: TokenStatus
  bombs?: TokenStatus
}

export interface LandingPageData {
  guildName: string
  guildStats: LandingPageGuildStats
  personalStats: LandingPagePersonalStats
  currentBoss: LandingPageBossOverview
  primeBosses: {
    prime1: LandingPageBossOverview | null
    prime2: LandingPageBossOverview | null
  }
  managementData: LandingPageManagementData
  credentialHealth: CredentialHealthSummary
  tokenData?: TokenData
}

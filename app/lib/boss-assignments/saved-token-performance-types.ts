import type { ExpectedTokensTier } from './performance-score'
import type { GuildSummary } from './performance-leaderboard-aggregate'
import type { TokenPerformanceLoopEntry } from './token-performance-types'

export type SavedTokenPerformanceEncounters = 'main' | 'main-and-primes'

export interface SavedTokenPerformancePageContext {
  source: 'saved-local'
  seasons: string[]
  season: string | null
  canCalculate: true
  /** Opaque caller-scope fence. Never render this value. */
  contextKey: string
}

export interface SavedTokenPerformanceBoss {
  bossKey: string
  bossName: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounterId: 0 | 1 | 2
  score: number | null
  tier: ExpectedTokensTier
  tokensSpent: number
  expectedTokens: number | null
  actualDamage: number
  expectedDamage: number | null
  perLoop: TokenPerformanceLoopEntry[]
}

export interface SavedTokenPerformancePlayer {
  /** Stable opaque React key, not a display label or DOM attribute. */
  rowKey: string
  name: string
  bossCount: number
  scoredBossCount: number
  tokensSpent: number
  expectedTokens: number
  weightedScore: number | null
  tierCounts: Partial<Record<ExpectedTokensTier, number>>
  bosses: SavedTokenPerformanceBoss[]
}

export interface SavedTokenPerformance {
  source: 'saved-local'
  season: string
  configId: string
  asOf: string
  timeZone: string
  cohort: 'own-guild'
  rarities: ['Legendary', 'Mythic']
  encounters: SavedTokenPerformanceEncounters
  currentSavedRoster: true
  /** Current saved targets are not a historical target snapshot at asOf. */
  targets: 'current-saved'
  players: SavedTokenPerformancePlayer[]
  summary: GuildSummary
}

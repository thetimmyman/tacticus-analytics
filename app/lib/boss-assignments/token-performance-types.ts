import type { ExpectedTokensTier } from '@/app/lib/boss-assignments/performance-score'

export interface TokenPerformanceLoopEntry {
  loopIndex: number
  score: number | null
  tokensSpent: number
  actualDamage: number
}

export interface TokenPerformanceEntry {
  /** Match identity on this; displayName is for presentation only. */
  playerId?: string
  displayName?: string
  /** 0 = main, 1/2 = primes. */
  encounterId?: number
  score: number | null
  tier: ExpectedTokensTier
  tokensSpent: number
  expectedTokens: number | null
  actualDamage: number
  expectedDamage: number | null
  perLoop?: Record<number, TokenPerformanceLoopEntry>
}

export type TokenPerformanceData = Record<
  string,
  Record<string, TokenPerformanceEntry>
>

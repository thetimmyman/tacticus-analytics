/** Loops reuse the season-baseline `expectedTokens` so trends reflect the player. */

import { computePerformanceScoreAggregate } from '@/app/lib/boss-assignments/performance-score'
import type { TokenPerformanceLoopEntry } from '@/app/lib/boss-assignments/token-performance-types'

export interface PerLoopBucket {
  total: number
  count: number
}

/** `undefined` (not `{}`) when no loop is valid. */
export function buildPerLoopEntries(
  loops: Iterable<[number, PerLoopBucket]>,
  bossHp: number,
  expectedTokens: number | null
): Record<number, TokenPerformanceLoopEntry> | undefined {
  const perLoop: Record<number, TokenPerformanceLoopEntry> = {}
  for (const [loopIndex, loopData] of loops) {
    if (!Number.isFinite(loopIndex) || loopData.count <= 0) continue
    const scored = computePerformanceScoreAggregate({
      actualDamage: loopData.total,
      tokensSpent: loopData.count,
      bossHp,
      expectedTokens
    })
    perLoop[loopIndex] = {
      loopIndex,
      score: scored.score,
      tokensSpent: loopData.count,
      actualDamage: loopData.total
    }
  }
  return Object.keys(perLoop).length > 0 ? perLoop : undefined
}

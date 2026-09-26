import type { TokenPerformanceData } from '@/app/lib/boss-assignments/token-performance-types'

export const NEEDS_REVIEW_TARGET = 0.9
export const RECOGNITION_TARGET = 1.05

export interface TargetBoss {
  bossName: string
  raritySet: string | null
  encounterId: number
  score: number
  tokensSpent: number
  expectedPerAttack: number | null
}

export function isNeedsReviewScore(targetScore: number | null): boolean {
  return targetScore != null && targetScore < NEEDS_REVIEW_TARGET
}

export function isRecognitionScore(targetScore: number | null): boolean {
  return targetScore != null && targetScore >= RECOGNITION_TARGET
}

export function extremeTargetBoss(
  entries: TokenPerformanceData[string] | undefined,
  extreme: 'worst' | 'best'
): TargetBoss | null {
  if (!entries) return null
  let out: TargetBoss | null = null
  for (const [bossKey, entry] of Object.entries(entries)) {
    if (entry.score == null) continue
    const isBetter =
      !out ||
      (extreme === 'worst' ? entry.score < out.score : entry.score > out.score)
    if (!isBetter) continue
    const match = bossKey.match(/^(.*)_([LM]\d+)$/)
    out = {
      bossName: match ? (match[1] ?? bossKey) : bossKey,
      raritySet: match ? (match[2] ?? null) : null,
      encounterId: entry.encounterId ?? 0,
      score: entry.score,
      tokensSpent: entry.tokensSpent,
      expectedPerAttack:
        entry.expectedDamage != null && entry.tokensSpent > 0
          ? entry.expectedDamage / entry.tokensSpent
          : null
    }
  }
  return out
}

import { describe, it, expect } from 'vitest'
import {
  NEEDS_REVIEW_TARGET,
  RECOGNITION_TARGET,
  isNeedsReviewScore,
  isRecognitionScore,
  extremeTargetBoss
} from '@/app/lib/officer-briefing/target-score'
import type { TokenPerformanceData } from '@/app/lib/boss-assignments/token-performance-types'

describe('WI-2810 target-score thresholds (1.0 = on target)', () => {
  it('NEEDS_REVIEW_TARGET / RECOGNITION_TARGET match the product-decided values', () => {
    expect(NEEDS_REVIEW_TARGET).toBe(0.9)
    expect(RECOGNITION_TARGET).toBe(1.05)
  })

  it('a member with weightedScore 0.87 lands in needs-support', () => {
    expect(isNeedsReviewScore(0.87)).toBe(true)
    expect(isRecognitionScore(0.87)).toBe(false)
  })

  it('a member with weightedScore 1.10 lands in doing-great', () => {
    expect(isNeedsReviewScore(1.1)).toBe(false)
    expect(isRecognitionScore(1.1)).toBe(true)
  })

  it('a member with weightedScore 0.95 lands in neither', () => {
    expect(isNeedsReviewScore(0.95)).toBe(false)
    expect(isRecognitionScore(0.95)).toBe(false)
  })

  it('boundary values are inclusive/exclusive as documented', () => {
    // needsReview is strict "<"; recognition is inclusive ">=".
    expect(isNeedsReviewScore(0.9)).toBe(false)
    expect(isRecognitionScore(1.05)).toBe(true)
  })

  it('a null target score never surfaces (best-effort degrade, no throw)', () => {
    expect(isNeedsReviewScore(null)).toBe(false)
    expect(isRecognitionScore(null)).toBe(false)
  })
})

describe('extremeTargetBoss — worst/best per-boss target score', () => {
  const entries: TokenPerformanceData[string] = {
    Ghazghkull_M1: {
      score: 0.72,
      tier: 'rarity_set_guild',
      tokensSpent: 4,
      expectedTokens: 3,
      actualDamage: 1_000_000,
      expectedDamage: 1_400_000
    },
    RogalDorn_L4: {
      score: 1.2,
      tier: 'rarity_set_guild',
      tokensSpent: 2,
      expectedTokens: 2,
      actualDamage: 900_000,
      expectedDamage: 750_000
    },
    Magnus_L3: {
      // Unscored: must never win either extreme (not treated as 0).
      score: null,
      tier: 'insufficient',
      tokensSpent: 1,
      expectedTokens: null,
      actualDamage: 100_000,
      expectedDamage: null
    }
  }

  it('the worst-boss label is derived from the lowest per-boss score', () => {
    const worst = extremeTargetBoss(entries, 'worst')
    expect(worst?.bossName).toBe('Ghazghkull')
    expect(worst?.raritySet).toBe('M1')
    expect(worst?.score).toBe(0.72)
    expect(worst?.tokensSpent).toBe(4)
    expect(worst?.encounterId).toBe(0)
  })

  it('the best-boss label is derived from the highest per-boss score', () => {
    const best = extremeTargetBoss(entries, 'best')
    expect(best?.bossName).toBe('RogalDorn')
    expect(best?.raritySet).toBe('L4')
    expect(best?.score).toBe(1.2)
  })

  it('computes expectedPerAttack from expectedDamage / tokensSpent', () => {
    const worst = extremeTargetBoss(entries, 'worst')
    expect(worst?.expectedPerAttack).toBe(1_400_000 / 4)
  })

  it('an entry with a null score is ignored entirely', () => {
    const single: TokenPerformanceData[string] = {
      Magnus_L3: {
        score: null,
        tier: 'insufficient',
        tokensSpent: 1,
        expectedTokens: null,
        actualDamage: 100_000,
        expectedDamage: null
      }
    }
    expect(extremeTargetBoss(single, 'worst')).toBeNull()
    expect(extremeTargetBoss(single, 'best')).toBeNull()
  })

  it('returns null for undefined entries (member absent from tokenPerf)', () => {
    expect(extremeTargetBoss(undefined, 'worst')).toBeNull()
    expect(extremeTargetBoss(undefined, 'best')).toBeNull()
  })

  it('reads encounterId off a prime entry (WI-2810 includePrimes)', () => {
    const withPrime: TokenPerformanceData[string] = {
      Corrodius_L2: {
        score: 0.5,
        tier: 'rarity_set_guild',
        tokensSpent: 3,
        expectedTokens: 3,
        actualDamage: 500_000,
        expectedDamage: 1_000_000,
        encounterId: 2
      }
    }
    const worst = extremeTargetBoss(withPrime, 'worst')
    expect(worst?.encounterId).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'
import {
  computePerformanceScore,
  computePerformanceScoreAggregate,
  resolveExpectedTokens
} from '@/app/lib/boss-assignments/performance-score'

describe('computePerformanceScore (leaf)', () => {
  it('returns 1.0 when actual matches expected', () => {
    expect(
      computePerformanceScore({
        actualDamage: 1_000_000,
        expectedDamagePerToken: 1_000_000
      }).score
    ).toBe(1)
  })

  it('returns >1 for overkill hits', () => {
    const result = computePerformanceScore({
      actualDamage: 1_500_000,
      expectedDamagePerToken: 1_000_000
    })
    expect(result.score).toBeCloseTo(1.5)
  })

  it('returns <1 for weak hits', () => {
    const result = computePerformanceScore({
      actualDamage: 750_000,
      expectedDamagePerToken: 1_000_000
    })
    expect(result.score).toBeCloseTo(0.75)
  })

  it('returns 0 for zero damage (not null)', () => {
    expect(
      computePerformanceScore({
        actualDamage: 0,
        expectedDamagePerToken: 1_000_000
      }).score
    ).toBe(0)
  })

  it('returns null (not Infinity) when expected is zero', () => {
    expect(
      computePerformanceScore({
        actualDamage: 1_000_000,
        expectedDamagePerToken: 0
      }).score
    ).toBeNull()
  })

  it('returns null when expected is negative or non-finite', () => {
    expect(
      computePerformanceScore({ actualDamage: 1, expectedDamagePerToken: -1 })
        .score
    ).toBeNull()
    expect(
      computePerformanceScore({
        actualDamage: 1,
        expectedDamagePerToken: Infinity
      }).score
    ).toBeNull()
    expect(
      computePerformanceScore({ actualDamage: 1, expectedDamagePerToken: NaN })
        .score
    ).toBeNull()
  })

  it('clamps negative actual damage to zero', () => {
    expect(
      computePerformanceScore({
        actualDamage: -500,
        expectedDamagePerToken: 1000
      }).score
    ).toBe(0)
  })
})

describe('computePerformanceScoreAggregate', () => {
  it('scores 1.0 when player damage matches plan (10M HP, 10 tokens expected, spent 5, dealt 5M)', () => {
    const result = computePerformanceScoreAggregate({
      actualDamage: 5_000_000,
      tokensSpent: 5,
      bossHp: 10_000_000,
      expectedTokens: 10
    })
    expect(result.score).toBe(1)
  })

  it('scores 1.5 for overkill (10M HP, 10 tokens, spent 2, dealt 3M)', () => {
    const result = computePerformanceScoreAggregate({
      actualDamage: 3_000_000,
      tokensSpent: 2,
      bossHp: 10_000_000,
      expectedTokens: 10
    })
    expect(result.score).toBeCloseTo(1.5)
  })

  it('handles fractional tokens (e.g. 0.5 tokens from a bomb)', () => {
    const result = computePerformanceScoreAggregate({
      actualDamage: 500_000,
      tokensSpent: 0.5,
      bossHp: 10_000_000,
      expectedTokens: 10
    })
    expect(result.score).toBe(1)
  })

  it('returns null when tokensSpent is 0 (not Infinity)', () => {
    const result = computePerformanceScoreAggregate({
      actualDamage: 1_000_000,
      tokensSpent: 0,
      bossHp: 10_000_000,
      expectedTokens: 10
    })
    expect(result.score).toBeNull()
  })

  it('returns null when expectedTokens is null (insufficient history)', () => {
    const result = computePerformanceScoreAggregate({
      actualDamage: 1_000_000,
      tokensSpent: 3,
      bossHp: 10_000_000,
      expectedTokens: null
    })
    expect(result.score).toBeNull()
  })

  it('returns null when bossHp is 0 or invalid', () => {
    expect(
      computePerformanceScoreAggregate({
        actualDamage: 1_000_000,
        tokensSpent: 1,
        bossHp: 0,
        expectedTokens: 10
      }).score
    ).toBeNull()
    expect(
      computePerformanceScoreAggregate({
        actualDamage: 1_000_000,
        tokensSpent: 1,
        bossHp: -1,
        expectedTokens: 10
      }).score
    ).toBeNull()
  })
})

describe('resolveExpectedTokens (5-tier fallback)', () => {
  it('uses officer-set target when present, overriding per-boss history', () => {
    const resolved = resolveExpectedTokens({
      officerTargetTokens: 6,
      perBossTokens: 11.16,
      perBossSampleCount: 30,
      guildCohort: { meanTokensToKill: 4.2, sampleCount: 99 }
    })
    expect(resolved.tier).toBe('officer_target')
    expect(resolved.expectedTokens).toBe(6)
    expect(resolved.sampleCount).toBe(0)
  })

  it('officer target ceils to integer when provided as float', () => {
    const resolved = resolveExpectedTokens({ officerTargetTokens: 6.4 })
    expect(resolved.tier).toBe('officer_target')
    expect(resolved.expectedTokens).toBe(7)
  })

  it('zero / negative / non-finite officerTargetTokens falls through to next tier', () => {
    const r1 = resolveExpectedTokens({
      officerTargetTokens: 0,
      perBossTokens: 8
    })
    expect(r1.tier).toBe('per_boss')
    const r2 = resolveExpectedTokens({
      officerTargetTokens: -3,
      perBossTokens: 8
    })
    expect(r2.tier).toBe('per_boss')
    const r3 = resolveExpectedTokens({
      officerTargetTokens: NaN,
      perBossTokens: 8
    })
    expect(r3.tier).toBe('per_boss')
  })

  it('partial rollout: one boss has officer target, another falls through to per_boss', () => {
    const withTarget = resolveExpectedTokens({
      officerTargetTokens: 10,
      perBossTokens: 14.2
    })
    const withoutTarget = resolveExpectedTokens({
      officerTargetTokens: null,
      perBossTokens: 14.2
    })
    expect(withTarget.tier).toBe('officer_target')
    expect(withTarget.expectedTokens).toBe(10)
    expect(withoutTarget.tier).toBe('per_boss')
    expect(withoutTarget.expectedTokens).toBe(15) // ceil(14.2)
  })

  it('uses per-boss history when present (rounded up to integer — WI-649)', () => {
    const resolved = resolveExpectedTokens({
      perBossTokens: 8,
      perBossSampleCount: 12,
      guildCohort: { meanTokensToKill: 4.2, sampleCount: 99 }
    })
    expect(resolved.tier).toBe('per_boss')
    expect(resolved.expectedTokens).toBe(8)
    expect(resolved.sampleCount).toBe(12)
  })

  it('per-boss float tokens ceil up (11.16 → 12)', () => {
    const resolved = resolveExpectedTokens({
      perBossTokens: 11.16,
      perBossSampleCount: 20
    })
    expect(resolved.tier).toBe('per_boss')
    expect(resolved.expectedTokens).toBe(12)
  })

  it('falls back to guild (rarity,set) cohort with ceil() rounding — user L1 example: 4.2 -> 5', () => {
    const resolved = resolveExpectedTokens({
      perBossTokens: null,
      guildCohort: { meanTokensToKill: 4.2, sampleCount: 40 },
      clusterCohort: { meanTokensToKill: 3.8, sampleCount: 200 }
    })
    expect(resolved.tier).toBe('rarity_set_guild')
    expect(resolved.expectedTokens).toBe(5)
    expect(resolved.sampleCount).toBe(40)
  })

  it('ceil() always rounds up even when mean is 3.01', () => {
    const resolved = resolveExpectedTokens({
      guildCohort: { meanTokensToKill: 3.01, sampleCount: 5 }
    })
    expect(resolved.expectedTokens).toBe(4)
  })

  it('whole-number means stay intact (5.0 -> 5, not 6)', () => {
    const resolved = resolveExpectedTokens({
      guildCohort: { meanTokensToKill: 5, sampleCount: 5 }
    })
    expect(resolved.expectedTokens).toBe(5)
  })

  it('falls back to cluster cohort when guild has no samples', () => {
    const resolved = resolveExpectedTokens({
      guildCohort: { meanTokensToKill: 0, sampleCount: 0 },
      clusterCohort: { meanTokensToKill: 6.3, sampleCount: 150 }
    })
    expect(resolved.tier).toBe('rarity_set_cluster')
    expect(resolved.expectedTokens).toBe(7)
  })

  it('falls back to global cohort when guild+cluster are empty', () => {
    const resolved = resolveExpectedTokens({
      globalCohort: { meanTokensToKill: 2.2, sampleCount: 5000 }
    })
    expect(resolved.tier).toBe('rarity_set_global')
    expect(resolved.expectedTokens).toBe(3)
  })

  it('returns insufficient when every tier is empty (does not fabricate a number)', () => {
    const resolved = resolveExpectedTokens({})
    expect(resolved.tier).toBe('insufficient')
    expect(resolved.expectedTokens).toBeNull()
    expect(resolved.sampleCount).toBe(0)
  })

  it('skips cohorts with 0 samples even if meanTokensToKill is set', () => {
    const resolved = resolveExpectedTokens({
      guildCohort: { meanTokensToKill: 3, sampleCount: 0 },
      clusterCohort: { meanTokensToKill: 4.5, sampleCount: 10 }
    })
    expect(resolved.tier).toBe('rarity_set_cluster')
    expect(resolved.expectedTokens).toBe(5)
  })
})

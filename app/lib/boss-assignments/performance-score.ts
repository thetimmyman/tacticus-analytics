/** Score = actual damage / expected damage per token; 1.0 = exactly their share. */

export type ExpectedTokensTier =
  | 'officer_target' // officer-set normative target (highest priority)
  | 'per_boss'
  | 'rarity_set_guild'
  | 'rarity_set_cluster'
  | 'rarity_set_global'
  | 'skipped' // officer / sentinel skip — no expected tokens, no loss
  | 'insufficient'

export interface ResolvedExpectedTokens {
  expectedTokens: number | null
  tier: ExpectedTokensTier
  sampleCount: number
}

export interface CohortStats {
  meanTokensToKill: number
  sampleCount: number
}

export interface ExpectedTokensResolutionInput {
  /** Wins over every auto-derived tier. */
  officerTargetTokens?: number | null
  skip?: boolean
  perBossTokens?: number | null
  perBossSampleCount?: number
  guildCohort?: CohortStats | null
  clusterCohort?: CohortStats | null
  globalCohort?: CohortStats | null
}

export interface PerformanceScoreInput {
  actualDamage: number
  expectedDamagePerToken: number
}

export interface PerformanceScoreAggregateInput {
  actualDamage: number
  tokensSpent: number
  bossHp: number
  expectedTokens: number | null
}

export interface PerformanceScoreResult {
  score: number | null
  tier?: ExpectedTokensTier
}

const isPositiveFinite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0

/** Rounded up to whole tokens; `loss` and `score` stay fractional. */
export function resolveExpectedTokens(
  input: ExpectedTokensResolutionInput
): ResolvedExpectedTokens {
  if (input.skip === true) {
    return { expectedTokens: null, tier: 'skipped', sampleCount: 0 }
  }

  if (isPositiveFinite(input.officerTargetTokens)) {
    return {
      expectedTokens: Math.ceil(input.officerTargetTokens),
      tier: 'officer_target',
      sampleCount: 0 // officer-asserted; no sample count semantic
    }
  }

  if (isPositiveFinite(input.perBossTokens)) {
    return {
      expectedTokens: Math.ceil(input.perBossTokens),
      tier: 'per_boss',
      sampleCount: input.perBossSampleCount ?? 0
    }
  }

  const cohorts: Array<[ExpectedTokensTier, CohortStats | null | undefined]> = [
    ['rarity_set_guild', input.guildCohort],
    ['rarity_set_cluster', input.clusterCohort],
    ['rarity_set_global', input.globalCohort]
  ]

  for (const [tier, stats] of cohorts) {
    if (
      stats &&
      isPositiveFinite(stats.meanTokensToKill) &&
      stats.sampleCount > 0
    ) {
      return {
        expectedTokens: Math.ceil(stats.meanTokensToKill),
        tier,
        sampleCount: stats.sampleCount
      }
    }
  }

  return { expectedTokens: null, tier: 'insufficient', sampleCount: 0 }
}

/** Null (not Infinity or 0) when the denominator is invalid. */
export function computePerformanceScore(
  input: PerformanceScoreInput
): PerformanceScoreResult {
  if (!isPositiveFinite(input.expectedDamagePerToken)) {
    return { score: null }
  }
  const actual = Math.max(0, input.actualDamage)
  return { score: actual / input.expectedDamagePerToken }
}

export function computePerformanceScoreAggregate(
  input: PerformanceScoreAggregateInput
): PerformanceScoreResult {
  if (!isPositiveFinite(input.bossHp)) return { score: null }
  if (!isPositiveFinite(input.expectedTokens)) return { score: null }
  if (!Number.isFinite(input.tokensSpent) || input.tokensSpent <= 0) {
    return { score: null }
  }

  const expectedDamagePerToken = input.bossHp / input.expectedTokens
  const expectedTotalDamage = input.tokensSpent * expectedDamagePerToken
  if (!isPositiveFinite(expectedTotalDamage)) return { score: null }

  const actual = Math.max(0, input.actualDamage)
  return { score: actual / expectedTotalDamage }
}

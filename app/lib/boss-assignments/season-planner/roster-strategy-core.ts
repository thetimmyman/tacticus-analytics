import type {
  PlannerResult,
  PlannedSession
} from '@/app/lib/boss-assignments/season-planner/planner-engine'
import type { StrengthState } from '@/app/lib/meta/roster-strength'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

export type StrategyPlanSummary = {
  guildCode: string
  memberCount: number
  tokensSpent: number
  tokensHeld: number
  wastedTokens: number
  bossesDefeated: number
  loopAdvances: number
  appliedDamage: number
  expectedDamage: number
  overkillDamage: number
  tokenEfficiency: number
  finalStageCode: string
  finalLoopIndex: number
  tokensRemainingSpendable: number | null
}

export type StrategyPlanDelta = {
  tokensSpent: number
  wastedTokens: number
  bossesDefeated: number
  loopAdvances: number
  appliedDamage: number
  expectedDamage: number
  overkillDamage: number
  tokenEfficiency: number
  score: number
}

export type StrategyMemberContribution = {
  playerId: string
  displayName: string
  tokensSpent: number
  appliedDamage: number
  expectedDamage: number
  tokenEfficiency: number
}

export type StrategyOptimizerCandidate = {
  candidatePlayerId: string
  candidateDisplayName: string
  candidateGuildCode: string
  replacedPlayerId: string
  replacedDisplayName: string
  baseline: StrategyPlanSummary
  projected: StrategyPlanSummary
  delta: StrategyPlanDelta
  fitDamage: number
  sampleCount: number
  reasons: string[]
}

export type InvestmentDemand = {
  heroName: string
  unitId: string | null
  bossName: string
  raritySet: string | null
  damageP90: number
  attackCount: number
}

export type InvestmentHeroState = {
  heroName: string
  unitId: string | null
  category: string | null
  rankName: string | null
  rankIndex: number | null
  activeAbility: number | null
  passiveAbility: number | null
  progressionIndex: number | null
  stars: number | null
}

export type InvestmentRecommendation = {
  playerId: string
  displayName: string
  heroName: string
  unitId: string | null
  state: StrengthState | 'Unknown'
  priorityScore: number
  bossNames: string[]
  raritySets: string[]
  currentRank: string | null
  currentAbilities: {
    active: number | null
    passive: number | null
  }
  recommendation: string
}

const round = (value: number, places = 0): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const sessionActionTotals = (sessions: PlannedSession[]) => {
  let appliedDamage = 0
  let expectedDamage = 0
  let overkillDamage = 0

  for (const session of sessions) {
    for (const action of session.actions ?? []) {
      appliedDamage += action.appliedDamage ?? 0
      expectedDamage += action.expectedDamage ?? 0
      overkillDamage += action.overkillDamage ?? 0
    }
  }

  return { appliedDamage, expectedDamage, overkillDamage }
}

export const summarizePlannerResult = (args: {
  guildCode: string
  memberCount: number
  result: PlannerResult
  tokensRemainingSpendable?: number | null
}): StrategyPlanSummary => {
  const tokensHeld = args.result.sessions.reduce(
    (sum, session) => sum + (session.tokensHeld ?? 0),
    0
  )
  const totals = sessionActionTotals(args.result.sessions)
  const tokensSpent = args.result.metrics.tokensSpent ?? 0

  return {
    guildCode: args.guildCode,
    memberCount: args.memberCount,
    tokensSpent,
    tokensHeld,
    wastedTokens: args.result.metrics.wastedTokens ?? 0,
    bossesDefeated: args.result.metrics.bossesDefeated ?? 0,
    loopAdvances: args.result.metrics.loopAdvances ?? 0,
    appliedDamage: Math.round(totals.appliedDamage),
    expectedDamage: Math.round(totals.expectedDamage),
    overkillDamage: Math.round(totals.overkillDamage),
    tokenEfficiency:
      tokensSpent > 0 ? Math.round(totals.appliedDamage / tokensSpent) : 0,
    finalStageCode: args.result.finalRaidState.stageCode,
    finalLoopIndex: args.result.finalRaidState.loopIndex,
    tokensRemainingSpendable: args.tokensRemainingSpendable ?? null
  }
}

export const diffStrategySummaries = (
  projected: StrategyPlanSummary,
  baseline: StrategyPlanSummary
): StrategyPlanDelta => {
  const delta = {
    tokensSpent: projected.tokensSpent - baseline.tokensSpent,
    wastedTokens: projected.wastedTokens - baseline.wastedTokens,
    bossesDefeated: projected.bossesDefeated - baseline.bossesDefeated,
    loopAdvances: projected.loopAdvances - baseline.loopAdvances,
    appliedDamage: projected.appliedDamage - baseline.appliedDamage,
    expectedDamage: projected.expectedDamage - baseline.expectedDamage,
    overkillDamage: projected.overkillDamage - baseline.overkillDamage,
    tokenEfficiency: projected.tokenEfficiency - baseline.tokenEfficiency,
    score: 0
  }

  delta.score = scorePlanDelta(delta)
  return delta
}

export const scorePlanDelta = (delta: Omit<StrategyPlanDelta, 'score'>) =>
  round(
    delta.bossesDefeated * 1_000 +
      delta.loopAdvances * 250 +
      delta.tokenEfficiency / 10_000 +
      delta.appliedDamage / 5_000_000 -
      delta.wastedTokens * 25 -
      delta.overkillDamage / 10_000_000,
    2
  )

export const summarizeMemberContributions = (
  sessions: PlannedSession[]
): StrategyMemberContribution[] => {
  const byPlayer = new Map<string, StrategyMemberContribution>()

  for (const session of sessions) {
    const playerId = session.playerId
    const displayName =
      typeof session.playerDisplayName === 'string' &&
      session.playerDisplayName.trim().length > 0
        ? session.playerDisplayName
        : playerId
    const current =
      byPlayer.get(playerId) ??
      ({
        playerId,
        displayName,
        tokensSpent: 0,
        appliedDamage: 0,
        expectedDamage: 0,
        tokenEfficiency: 0
      } satisfies StrategyMemberContribution)

    current.displayName = displayName
    current.tokensSpent += session.tokensSpent ?? 0
    for (const action of session.actions ?? []) {
      current.appliedDamage += action.appliedDamage ?? 0
      current.expectedDamage += action.expectedDamage ?? 0
    }
    byPlayer.set(playerId, current)
  }

  return Array.from(byPlayer.values())
    .map((entry) => ({
      ...entry,
      appliedDamage: Math.round(entry.appliedDamage),
      expectedDamage: Math.round(entry.expectedDamage),
      tokenEfficiency:
        entry.tokensSpent > 0
          ? Math.round(entry.appliedDamage / entry.tokensSpent)
          : 0
    }))
    .sort(
      (a, b) =>
        a.appliedDamage - b.appliedDamage ||
        a.tokensSpent - b.tokensSpent ||
        a.displayName.localeCompare(b.displayName)
    )
}

export const rankOptimizerCandidates = (
  candidates: StrategyOptimizerCandidate[],
  limit: number
): StrategyOptimizerCandidate[] =>
  [...candidates]
    .sort((a, b) => {
      if (b.delta.score !== a.delta.score) return b.delta.score - a.delta.score
      if (b.fitDamage !== a.fitDamage) return b.fitDamage - a.fitDamage
      return a.candidateDisplayName.localeCompare(b.candidateDisplayName)
    })
    .slice(0, Math.max(0, Math.trunc(limit)))

const normalizeHeroKey = normalizeIdentifier

const stateWeight: Record<InvestmentRecommendation['state'], number> = {
  Weak: 1,
  Suitable: 0.7,
  Strong: 0.35,
  Optimal: 0,
  Locked: 0,
  Invalid: 0.15,
  Unknown: 0.25
}

export const rankInvestmentRecommendations = (args: {
  playerId: string
  displayName: string
  heroStates: InvestmentHeroState[]
  demand: InvestmentDemand[]
  resolveState: (
    hero: InvestmentHeroState,
    demand: InvestmentDemand
  ) => StrengthState | null
  describeNextStep: (
    hero: InvestmentHeroState,
    state: StrengthState | 'Unknown',
    demand: InvestmentDemand
  ) => string
  limit: number
}): InvestmentRecommendation[] => {
  const demandByHero = new Map<string, InvestmentDemand[]>()
  for (const demand of args.demand) {
    const key = normalizeHeroKey(demand.heroName || demand.unitId)
    if (!key) continue
    const list = demandByHero.get(key) ?? []
    list.push(demand)
    demandByHero.set(key, list)
  }

  const recommendations: InvestmentRecommendation[] = []

  for (const hero of args.heroStates) {
    const demand = demandByHero.get(normalizeHeroKey(hero.heroName)) ?? []
    if (demand.length === 0 && hero.unitId) {
      demand.push(...(demandByHero.get(normalizeHeroKey(hero.unitId)) ?? []))
    }
    if (demand.length === 0) continue

    const bossNames = new Set<string>()
    const raritySets = new Set<string>()
    let totalDemand = 0
    let chosenState: StrengthState | 'Unknown' = 'Unknown'
    let chosenDemand = demand[0]!

    for (const entry of demand) {
      bossNames.add(entry.bossName)
      if (entry.raritySet) raritySets.add(entry.raritySet)
      totalDemand +=
        Math.max(0, entry.damageP90) *
        Math.max(1, Math.log2((entry.attackCount ?? 0) + 2))
      const state = args.resolveState(hero, entry) ?? 'Unknown'
      if (stateWeight[state] > stateWeight[chosenState]) {
        chosenState = state
        chosenDemand = entry
      }
    }

    const priorityScore = Math.round(totalDemand * stateWeight[chosenState])
    if (priorityScore <= 0) continue

    recommendations.push({
      playerId: args.playerId,
      displayName: args.displayName,
      heroName: hero.heroName,
      unitId: hero.unitId,
      state: chosenState,
      priorityScore,
      bossNames: Array.from(bossNames).slice(0, 5),
      raritySets: Array.from(raritySets).slice(0, 5),
      currentRank: hero.rankName,
      currentAbilities: {
        active: hero.activeAbility,
        passive: hero.passiveAbility
      },
      recommendation: args.describeNextStep(hero, chosenState, chosenDemand)
    })
  }

  return recommendations
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore
      }
      return a.heroName.localeCompare(b.heroName)
    })
    .slice(0, Math.max(0, Math.trunc(args.limit)))
}

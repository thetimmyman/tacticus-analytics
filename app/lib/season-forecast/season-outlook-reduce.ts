// No server-only or DB imports, so client components can import its types.

import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { SEASON_MAX_SPENDABLE_TOKENS } from '@/app/lib/calculations/token-calculation'
import {
  stageBudgetTokens,
  summarizeSequenceBudget
} from '@/app/lib/season-forecast/boss-feasibility-math'
import type { GeneratedSeasonPlanPayload } from '@/app/lib/boss-assignments/season-planner/generate-season-plan'
import type { PlayerTokenPaceRow } from '@/app/lib/season-forecast/season-token-economy'

/** Per player per season; a full 30-member guild ⇒ 840. */
export const SEASON_MAX_TOKENS_PER_PLAYER = SEASON_MAX_SPENDABLE_TOKENS

export const MAX_GUILD_MEMBERS = 30

export type SeasonOutlookConfidence = 'low' | 'medium' | 'high'

export interface SeasonOutlookFinish {
  stageCode: string
  bossName: string
  loopIndex: number
  /** 0..1 into the finishing lap's main encounter. */
  pctIntoFinalStage: number
  bossesDefeatedForward: number
}

export interface SeasonOutlookProjection {
  guildCode: string
  season: number
  generatedAt: string
  secondsRemaining: number

  memberCount: number
  seasonMaxTokensPerPlayer: number
  seasonBudget: number

  tokensUsed: number
  tokensRemaining: number
  projectedWaste: number
  playersAtCapRisk: number
  projectedForwardSpend: number

  finish: SeasonOutlookFinish | null
  confidence: SeasonOutlookConfidence
  /** Present only when officers set targets in the projected span; reporting only. */
  budget?: SeasonOutlookBudget
}

export interface SeasonOutlookBudget {
  /** Full budget of cleared stages plus the finish stage's budget scaled by pctIntoFinalStage. */
  targetBudgetTokens: number
  projectedSpendTokens: number
  projectedSpendVsBudgetTokens: number
  stagesWithTargets: number
}

/** Privacy: a sibling of SeasonOutlookProjection (which reaches member browsers); scope via outlook-player-scope.ts. */
export interface SeasonOutlookDetail {
  projection: SeasonOutlookProjection
  players: PlayerTokenPaceRow[]
}

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function deriveConfidence(args: {
  memberCount: number
  tokensUsed: number
  hasFinish: boolean
}): SeasonOutlookConfidence {
  if (!args.hasFinish || args.memberCount < 5 || args.tokensUsed < 10) {
    return 'low'
  }
  if (args.memberCount < 10 || args.tokensUsed < 50) return 'medium'
  return 'high'
}

export function reduceSeasonOutlook(
  payload: GeneratedSeasonPlanPayload,
  opts: { guildCode: string; seasonNumber: number; nowMs: number }
): SeasonOutlookProjection {
  const metrics = payload.plan.metrics
  const final = payload.plan.finalRaidState
  const mainEnc = final?.encounters?.[0] ?? null

  const seasonEndMs = Date.parse(payload.season_end_at)
  const secondsRemaining = Number.isFinite(seasonEndMs)
    ? Math.max(0, Math.floor((seasonEndMs - opts.nowMs) / 1000))
    : 0

  const memberCount = payload.member_count
  // Stale is_current rows must not inflate the budget above 30 members.
  const seasonBudget =
    Math.min(memberCount, MAX_GUILD_MEMBERS) * SEASON_MAX_TOKENS_PER_PLAYER
  const tokensUsed = Math.max(0, payload.tokens_used_this_season)
  const tokensRemaining = Math.max(0, payload.tokens_remaining_spendable)
  const projectedWaste = Math.max(0, payload.tokens_projected_waste)
  const projectedForwardSpend = Math.max(0, metrics.tokensSpent)

  // No modelled spend means "forecast building", not "finishes where it is now".
  let finish: SeasonOutlookFinish | null = null
  if (
    mainEnc &&
    metrics.tokensSpent > 0 &&
    (payload.remainingBossSequence?.length ?? 0) > 0
  ) {
    const pct =
      mainEnc.maxHp > 0 ? clamp01(1 - mainEnc.remainingHp / mainEnc.maxHp) : 0
    finish = {
      stageCode: final.stageCode,
      // Rotation slugs are lowercase ('rogaldorn'); only the override table maps them.
      bossName: getBossDisplayName(mainEnc.bossName),
      loopIndex: final.loopIndex,
      pctIntoFinalStage: pct,
      bossesDefeatedForward: Math.max(0, metrics.bossesDefeated)
    }
  }

  // The finish stage counts only its pct-scaled share; in full, a guild that
  // dies partway in would look under budget. Emitted only with an officer target.
  let budget: SeasonOutlookBudget | undefined
  if (finish !== null && payload.remainingBossSequence) {
    const sequence = payload.remainingBossSequence
    const finishIndex = sequence.findIndex(
      (entry) =>
        entry.stageCode === final.stageCode &&
        entry.loopIndex === final.loopIndex
    )
    if (finishIndex >= 0) {
      const summary = summarizeSequenceBudget(
        sequence.slice(0, finishIndex + 1)
      )
      if (summary) {
        const finishStageBudget = stageBudgetTokens(sequence[finishIndex]!)
        const targetBudgetTokens =
          summary.budgetTokens -
          finishStageBudget +
          Math.round(finishStageBudget * finish.pctIntoFinalStage)
        budget = {
          targetBudgetTokens,
          projectedSpendTokens: projectedForwardSpend,
          projectedSpendVsBudgetTokens:
            projectedForwardSpend - targetBudgetTokens,
          stagesWithTargets: summary.stagesWithTargets
        }
      }
    }
  }

  return {
    guildCode: opts.guildCode,
    season: opts.seasonNumber,
    generatedAt: new Date(opts.nowMs).toISOString(),
    secondsRemaining,
    memberCount,
    seasonMaxTokensPerPlayer: SEASON_MAX_TOKENS_PER_PLAYER,
    seasonBudget,
    tokensUsed,
    tokensRemaining,
    projectedWaste,
    playersAtCapRisk: Math.max(0, payload.players_at_cap_risk),
    projectedForwardSpend,
    finish,
    confidence: deriveConfidence({
      memberCount,
      tokensUsed,
      hasFinish: finish !== null
    }),
    ...(budget ? { budget } : {})
  }
}

export function reduceSeasonOutlookDetail(
  payload: GeneratedSeasonPlanPayload,
  opts: { guildCode: string; seasonNumber: number; nowMs: number }
): SeasonOutlookDetail {
  return {
    projection: reduceSeasonOutlook(payload, opts),
    players: payload.per_player_pace ?? []
  }
}

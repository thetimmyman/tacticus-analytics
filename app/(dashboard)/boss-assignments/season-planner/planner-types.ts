import type { PlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot-types'
import type { PlannerResult } from '@/app/lib/boss-assignments/season-planner/planner-engine'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

export type GeneratedSeasonPlanPayload = {
  season: string
  season_id: string | null
  season_start_at: string
  season_end_at: string
  snapshot_at: string
  time_zone: string
  lookback_days: number
  sessions_per_day: number
  snapshot: PlanFromNowSnapshot
  plan: PlannerResult
  remainingBossSequence?: BossStageEntry[]
  // Spendable-token ceiling (bank + regen); drives the reachable-frontier highlight.
  tokens_remaining_spendable?: number
}

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

export type RosterStrategyMember = {
  playerId: string
  displayName: string
  guildCode: string
  role: string | null
}

export type RosterStrategyProjection = {
  guildCode: string
  aggregate: StrategyPlanSummary
  seasons: Array<{
    season: string
    seasonId: string | null
    summary: StrategyPlanSummary
  }>
}

export type RosterStrategyOptimizerCandidate = {
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

export type RosterStrategyInvestment = {
  playerId: string
  displayName: string
  heroName: string
  unitId: string | null
  state: string
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

export type RosterStrategyPayload = {
  clusterCode: string | null
  targetGuildCode: string
  guilds: Array<{
    guildCode: string
    displayName: string | null
    clusterCode: string | null
    timeZone: string
  }>
  members: RosterStrategyMember[]
  seasons: Array<{ season: string; configId: string | null; label: string }>
  baseline: RosterStrategyProjection
  swap: {
    outgoing: RosterStrategyMember
    incoming: RosterStrategyMember
    targetGuildBefore: RosterStrategyProjection
    targetGuildAfter: RosterStrategyProjection
    targetGuildDelta: StrategyPlanDelta
    partnerGuildBefore: RosterStrategyProjection
    partnerGuildAfter: RosterStrategyProjection
    partnerGuildDelta: StrategyPlanDelta
    combinedDelta: StrategyPlanDelta
  } | null
  optimizer: RosterStrategyOptimizerCandidate[]
  investments: RosterStrategyInvestment[]
  warnings: string[]
}

export type SavedPlanSummary = {
  id: string
  season_id: string
  start_at: string
  end_at: string
  snapshot_at: string | null
  kind: 'baseline' | 'replan'
  baseline_key: string | null
  baseline_plan_id: string | null
  trigger: string
  seed: number | null
  plan_hash: string | null
  plan_metrics: JsonValue
  resolved_options: JsonValue
  created_by: string | null
  created_at: string
  updated_at: string
}

export type SavedPlanRow = SavedPlanSummary & {
  plan: JsonValue
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type StrategyRequestBody = {
  season?: string
  snapshot_at?: string
  lookback_days: number
  sessions_per_day: number
  time_zone: string
  season_count: number
  include_optimizer: boolean
  include_investments: boolean
  config_id?: string
  swap?: {
    outgoing_player_id: string
    incoming_player_id: string
  }
}

export type FetchErrorPayload = { error?: string; details?: string }
export type RosterEntry = { player_id: string; display_name: string | null }

export type StageTimelineRow = {
  stageCode: string
  loopIndex: number
  bossName: string
  startAt: string
  endAt: string
  tokens: number
  players: Array<{ playerId: string; displayName: string; tokens: number }>
  expectedDamage: number
  appliedDamage: number
  overkillDamage: number
}

export type ScheduleWindow = '24h' | '48h' | '7d' | 'all'

export type LoopTimelineRow = {
  loopIndex: number
  startAt: string
  endAt: string
  stages: number
  tokens: number
  uniquePlayers: number
}

export type PerPlayerTotalsRow = {
  playerId: string
  displayName: string
  sessions: number
  spent: number
  held: number
}

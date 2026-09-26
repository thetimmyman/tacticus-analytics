import type { serviceDb } from '@/app/lib/db'
import type { SeasonBoss } from '@/app/lib/loki/season-configs'
import type { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'
import type { PlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot-types'
import type { DamageModel } from '@/app/lib/boss-assignments/season-planner/damage-model'
import type {
  RaidState,
  StageTemplate
} from '@/app/lib/boss-assignments/season-planner/planner-engine'
import type {
  InvestmentRecommendation,
  StrategyMemberContribution,
  StrategyOptimizerCandidate,
  StrategyPlanDelta,
  StrategyPlanSummary
} from '@/app/lib/boss-assignments/season-planner/roster-strategy-core'

export type SupabaseService = ReturnType<typeof serviceDb>

export type RosterStrategyMember = {
  mappingId: number
  playerId: string
  displayName: string
  guildCode: string
  role: string | null
}

export type RosterStrategyPublicMember = {
  playerId: string
  displayName: string
  guildCode: string
  role: string | null
}

export type RosterStrategyGuild = {
  guildCode: string
  displayName: string | null
  clusterCode: string | null
  timeZone: string
}

export type RosterStrategySeasonSpec = {
  season: string
  configId: string | null
  label: string
}

export type RosterStrategyProjection = {
  guildCode: string
  aggregate: StrategyPlanSummary
  seasons: Array<{
    season: string
    seasonId: string | null
    summary: StrategyPlanSummary
  }>
  contributions: StrategyMemberContribution[]
}

export type RosterStrategySwapResult = {
  outgoing: RosterStrategyPublicMember
  incoming: RosterStrategyPublicMember
  targetGuildBefore: RosterStrategyProjection
  targetGuildAfter: RosterStrategyProjection
  targetGuildDelta: StrategyPlanDelta
  partnerGuildBefore: RosterStrategyProjection
  partnerGuildAfter: RosterStrategyProjection
  partnerGuildDelta: StrategyPlanDelta
  combinedDelta: StrategyPlanDelta
}

export type RosterStrategyPayload = {
  clusterCode: string | null
  targetGuildCode: string
  guilds: RosterStrategyGuild[]
  members: RosterStrategyPublicMember[]
  seasons: RosterStrategySeasonSpec[]
  baseline: RosterStrategyProjection
  swap: RosterStrategySwapResult | null
  optimizer: StrategyOptimizerCandidate[]
  investments: InvestmentRecommendation[]
  warnings: string[]
}

export type StrategyBattleRow = {
  userId: string
  displayName: string | null
  Guild: string | null
  damageType: 'Battle' | 'Bomb' | string
  startedOn: string
  damageDealt: number | null
  Name: string | null
  encounterId: number | null
  rarity: string | null
  set: number | null
  Season: string | number | null
}

export type ProjectionContext = {
  guildCode: string
  season: string
  seasonId: string | null
  seasonStartMs: number
  seasonEndMs: number
  seasonStartAt: string
  seasonEndAt: string
  snapshotAt: string
  timeZone: string
  snapshot: PlanFromNowSnapshot
  seasonBosses: SeasonBoss[]
  remainingBossSequence: BossStageEntry[]
  stageTemplates: StageTemplate[]
  raidState: RaidState
  damageModel: DamageModel
  battleRows: StrategyBattleRow[]
  signalRows: StrategyBattleRow[]
  tokenRows: StrategyBattleRow[]
  lookbackStartMs: number
  signalLookbackStartMs: number
  signalReferenceMs: number
  progressionConfig: Awaited<ReturnType<typeof getActiveProgressionConfig>>
}

export type RosterHeroRow = {
  player_mapping_id: number | null
  user_id: string | null
  rank_name: string | null
  stars: number | null
  progression_index: number | null
  active_ability_level: number | null
  passive_ability_level: number | null
  hero_mappings:
    | {
        unit_id: string | null
        display_name: string | null
        category: string | null
      }
    | Array<{
        unit_id: string | null
        display_name: string | null
        category: string | null
      }>
    | null
}

export type MetaAtlasRow = {
  season: string | null
  team_composition: string | null
  boss_type: string | null
  boss_unit_id: string | null
  rarity_set: string | null
  damage_p90: number | null
  attack_count: number | null
}

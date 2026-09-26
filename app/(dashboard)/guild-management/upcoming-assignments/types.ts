import type { Rarity } from '@/app/lib/config'
import type { UserProfile } from '@/app/lib/auth'
import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'
import type {
  TokenPerformanceData,
  TokenPerformanceEntry,
  TokenPerformanceLoopEntry
} from '@/app/lib/boss-assignments/token-performance-types'
export type {
  TokenPerformanceData,
  TokenPerformanceEntry,
  TokenPerformanceLoopEntry
}

export interface BossOption {
  boss_type: string
  boss_name: string
  tier: number
  set: number
  encounter_id: number
  rarity: Rarity
}

export interface HeroData {
  characterId?: string
  [key: string]: unknown
}

export type TeamComposition = HeroData[]

export interface GuildMemberRecord {
  player_id: string
  display_name: string
  guild_code: string | null
  is_current: boolean
  primary_boss?: string | null
  secondary_boss?: string | null
  boss_preferences?: Record<string, unknown> | string | null
}

export interface AssignmentRow {
  player_id: string
  display_name: string | null
  primary_boss: string | null
  secondary_boss: string | null
  token_allocations: Record<string, number> | null
  uses_flexible_tokens: boolean | null
}

export interface BossMapping {
  id: number
  boss_type: string
  boss_name: string
  encounter_index: number
  tier?: number
}

export interface PlayerAssignment {
  player_id: string
  display_name: string
  primary_boss: string | null
  secondary_boss: string | null
  boss_preferences?: Record<string, string> | string | null
  performance_data?: Record<string, { player_vs_guild_avg: number }>
  guild_code?: string
  is_active?: boolean
  avatar_unit_id?: string | null
}

export interface LokiBoss {
  boss_type: string
  boss_name: string
  set: number
  encounter_id: number
  rarity: string
  canonical: string
}

export interface BossHpData {
  legendary: Record<string, number>
  mythic: Record<string, number>
  primes: Record<string, number>
  byBossName: Record<string, number>
}

export interface GuildConfig {
  primary_assignment_tokens?: number
  secondary_assignment_tokens?: number
}

/** Slim `herald_boss_config` for the cascade, resolved by `resolveHeraldBossConfigs`. */
export interface HeraldCascadeConfigEntry {
  boss_id: string
  /** NULL = all stages; otherwise a per-stage override. */
  rarity_set: string | null
  side1_behaviour: 'skip' | 'kill' | 'threshold'
  side2_behaviour: 'skip' | 'kill' | 'threshold'
  side1_threshold_hp_pct: number | null
  side2_threshold_hp_pct: number | null
  /** Server-computed so `Magnus_E0`/`ThousMagnus_E0` rows match `normalizeBossKey(mainBoss)`. */
  canonical_key: string
}

export interface UpcomingAssignmentsClientProps {
  initialProfile: UserProfile
  initialPerformanceData: Record<
    string,
    Record<string, { player_vs_guild_avg: number; average_damage?: number }>
  >
  initialTokenPerformanceData?: TokenPerformanceData
  initialLatestSeason: string
  initialPrimeHpData: Record<string, number>
  initialBossHpData: BossHpData
  guildConfig: GuildConfig | null
  // Always 'current'; a non-live season renders the Season Planner.
  mode?: 'current'
  /** False = read-only member: mutation controls hidden, write-triggering effects no-op. */
  canEdit?: boolean
  lokiCurrentBosses?: LokiBoss[]
  progressionConfig: ProgressionConfig | null
  /** Herald per-prime config for the cascade; empty means everything defaults to 'kill'. */
  initialHeraldBossConfigs?: HeraldCascadeConfigEntry[]
}

export interface AssignmentData {
  primary: number
  secondary: number
  primaryTokens: number
  secondaryTokens: number
  totalTokens: number
  requiredTokens: number
  requiredPrimary: number
  requiredSecondary: number
  level: string
  avgDamage: number
  isPrime?: boolean
}

export type PerformanceData = Record<
  string,
  Record<string, { player_vs_guild_avg: number; average_damage?: number }>
>
export type HistoricalPerformance = Record<string, Record<string, number>>
export type PlayerTokenAllocations = Record<string, Record<string, number>>

export interface SolverAssignment {
  display_name: string
  bossId: string
  boss_name?: string
  boss_level?: string
  is_prime?: boolean
  tokens: number
  reasoning?: string
}

export interface SolverResponse {
  success: boolean
  allocations?: Record<string, Record<string, number>>
  assignments?: SolverAssignment[]
  warnings: string[]
  error?: string
  current_stage?: string
  current_loop?: number
  stage_assignments?: StageAssignmentEntry[]
  player_budgets?: Record<string, PlayerBudgetEntry>
  sequence?: QueueStageEntry[]
  metrics?: QueueMetrics
}

export interface StageEncounterProjectionEntry {
  bossName: string
  startingHp: number
  projectedRemainingHp: number
  projectedDamage: number
  tokensPlanned: number
  isPrime: boolean
}

export interface StageAssignmentEntry {
  stageCode: string
  loopIndex: number
  assignments: Array<{
    playerId: string
    bossId: string
    tokens: number
    score: number
    reasoning?: string
  }>
  coverage: { required: number; assigned: number; percentage: number }
  projections?: {
    main: StageEncounterProjectionEntry
    prime1: StageEncounterProjectionEntry | null
    prime2: StageEncounterProjectionEntry | null
  }
  // Binding officer-target caps (budget below model demand); absent when none binds.
  targetCaps?: StageTargetCapEntry[]
}

export interface StageTargetCapEntry {
  bossId: string
  encounter: 'main' | 'prime1' | 'prime2'
  capTokens: number
  modelTokensNeeded: number
  shortfallTokens: number
}

export interface PlayerBudgetEntry {
  playerId: string
  displayName: string
  totalTokens: number
  allocated: number
  reserved: number
  available: number
}

export interface QueueStageEntry {
  stageCode: string
  loopIndex: number
  difficulty: string
  estimatedTokensNeeded: number
  isCurrentStage: boolean
  mainBoss: string
  // Prime names so solver ids like "L4 sub1" render as "Sibyll"; null when absent.
  prime1Boss: string | null
  prime2Boss: string | null
}

export interface QueueMetrics {
  totalTokensPlanned: number
  projectedStages: number
  strongPlayerReservationRate: number
}

export interface PlayerMetaTeam {
  primary?: string
  secondary?: string
  tertiary?: string
}

export type MetaTeamData = Record<string, PlayerMetaTeam>

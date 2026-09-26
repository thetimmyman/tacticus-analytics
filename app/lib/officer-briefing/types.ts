// Copy says "a stronger team is available now", never "you used the wrong team".

export type MemberClassification =
  | 'needs_support_wrong_team' // underperforming AND a better team is fieldable now
  | 'needs_support_correct_team' // underperforming on the best team they can field → execution
  | 'roster_limited' // can't field a stronger team → SUPPRESSED (no coaching task)
  | 'doing_great' // materially above roster-adjusted expectation → recognize
  | 'insufficient_data' // too few attacks to judge

export type Confidence = 'high' | 'medium' | 'low'

export interface MemberSignalRow {
  displayName: string
  worstVsGuildPct: number | null
  bestVsGuildPct: number | null
  battleCount: number
  worstBossName: string | null
  worstEncounterId: number | null
  /** Attacks on the worst-signal boss only, so the count matches the signal. */
  worstBattleCount: number | null
  /** Caps tokens before season end (forecast per_player). */
  tokenCapRisk: boolean
  estimatedCapWaste: number | null
  bucket: 'needs_review' | 'recognition' | 'token_risk' | 'team_upgrade'
  /** Tokens-weighted mean across bosses (1.0 = on target); unset for team_upgrade/token_risk rows. */
  targetScore?: number | null
  rosterAdjustedPct?: number | null
  readyNowUpside?: number | null
  classification?: MemberClassification | null
  confidence?: Confidence | null
  swaps?: SwapStep[]
  recommendation?: string | null
  lastBattleSecondsAgo?: number | null
  tokensAvailable?: number | null
  tokenCapacity?: number | null
  strongStreak?: number | null
}

/** Rotation-aware outlook, not the deprecated `lap_projection`. */
export interface SeasonOutlookSummary {
  /** 1-indexed, matching the member card. */
  lap: number
  pctIntoLap: number
  bossName: string | null
  confidence: Confidence
}

export interface OfficerBriefingContext {
  guildCode: string
  guildName: string | null
  season: string
  activeBossLabel: string | null
  activeBossHpPct: number | null
  /** Derived from the live boss lifecycle, e.g. "Prime 1 + Prime 2"; null when unknown. */
  openTargetsLabel: string | null
  unassignedAttacks: number | null
  seasonOutlook: SeasonOutlookSummary | null
  capacityLeft: number | null
  membersCappingWithin12h: number | null
  nextReviewSeconds: number | null
  generatedAt: string
}

export type GuildPatternKind =
  'team_selection' | 'token_timing' | 'positive_trend'

export interface GuildPattern {
  kind: GuildPatternKind
  title: string
  detail: string
  href: string | null
  ctaLabel: string | null
}

export interface OfficerBriefingResponse {
  context: OfficerBriefingContext
  needsReview: MemberSignalRow[]
  recognition: MemberSignalRow[]
  tokenRisk: MemberSignalRow[]
  /** Independent guild-wide pass, not a subset of needsReview. */
  teamUpgrades: MemberSignalRow[]
  counts: {
    needsReview: number
    recognition: number
    tokenRisk: number
    teamUpgrades: number
  }
  teamUpgradeUpsideTotal: number
  patterns: GuildPattern[]
}

export interface TeamSummary {
  composition: string
  heroes: string[]
  mow: string | null
  metaTeam: string | null
}

export interface SwapStep {
  out: string
  in: string
}

export interface MemberBossVerdict {
  bossName: string
  /** Raw boss_type: the stable task key, since pretty names can collapse distinct bosses. */
  bossType: string
  encounterId: number
  rarity: string | null
  classification: MemberClassification
  confidence: Confidence
  actualAvg: number | null
  expectedForUsedTeam: number | null
  expectedForBestFieldable: number | null
  /** expectedForUsedTeam − actualAvg. */
  executionGap: number | null
  /** expectedForBestFieldable − expectedForUsedTeam. */
  selectionGap: number | null
  /** max(0, expectedForBestFieldable − actualAvg). */
  readyNowUpside: number | null
  teamUsed: TeamSummary | null
  bestFieldable: TeamSummary | null
  usedTeamHash: string
  recommendedTeamHash: string | null
  swaps: SwapStep[]
  battleCount: number
  recommendation: string
}

export interface RecentAttackPoint {
  startedAt: string
  damage: number
  expected: number | null
  bossName: string | null
}

export interface MemberDetailResponse {
  displayName: string
  guildCode: string
  season: string
  rosterSyncedAt: string | null
  verdicts: MemberBossVerdict[]
  headline: MemberBossVerdict | null
  coachingNote: string
  lastBattleSecondsAgo: number | null
  recentAttacks: RecentAttackPoint[]
}

type CoachingTaskStatus = 'open' | 'acknowledged' | 'dismissed' | 'resolved'
type CoachingTaskResolution =
  | 'swapped_improved'
  | 'swapped_no_change'
  | 'execution_improved'
  | 'execution_no_change'
  | 'not_swapped'
  | 'dismissed'

/** A snapshot of the verdict at assignment time, not a live recomputation. */
export interface CoachingTask {
  id: string
  displayName: string
  season: string
  bossType: string
  encounterIndex: number
  raritySet: string | null
  classification: MemberClassification
  confidence: Confidence
  readyNowUpside: number | null
  recommendedSwaps: SwapStep[]
  sourceBattleCount: number
  status: CoachingTaskStatus
  resolution: CoachingTaskResolution | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

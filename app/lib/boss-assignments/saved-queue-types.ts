import type {
  ReplacementAssignment,
  ReplacementBoss
} from '@/app/lib/boss-assignments/saved-assignments-input'

export interface SavedQueuePageContext {
  source: 'saved-local'
  seasons: string[]
  season: string | null
  canCalculate: boolean
  contextKey: string
}

export interface SavedQueueStageIdentity {
  stageCode: string
  loopIndex: number
}
export interface SavedQueueEncounterProjection {
  bossName: string
  startingHp: number
  projectedRemainingHp: number
  projectedDamage: number
  tokensPlanned: number
  isPrime: boolean
}
export interface SavedQueueStage extends SavedQueueStageIdentity {
  projectedStartAt: string
  inboundDurationSeconds: number | null
  inboundDurationSource: 'current_season' | 'rolling_window' | 'fallback' | null
  conditionalOnPriorClear: boolean
  assignments: {
    playerId: string
    encounter: 'main' | 'prime1' | 'prime2'
    tokens: number
  }[]
  projections: {
    main: SavedQueueEncounterProjection
    prime1: SavedQueueEncounterProjection | null
    prime2: SavedQueueEncounterProjection | null
  }
}
export interface SavedQueueCalculation {
  source: 'saved-season'
  season: string
  configId: string
  asOf: string
  timeZone: string
  rosterSource: 'current-saved-roster'
  players: {
    playerId: string
    displayName: string
    tier: 'strong' | 'mid' | 'developing'
    currentTokens: number
    nextRegenAt: string | null
    tokensUsedThisSeason: number
    spendableByEnd: number
    tokensPlanned: number
  }[]
  stages: SavedQueueStage[]
  replacement: {
    asOf: string
    bosses: ReplacementBoss[]
    assignments: ReplacementAssignment[]
  }
  metrics: { totalTokensPlanned: number; projectedStages: number }
  feasibility: {
    status: 'tokens-verified-at-projected-starts'
    stageStarts: 'historical-estimate'
    horizonEndExclusive: true
    projectedPrefix: {
      fullyClearedStageCount: number
      firstUnclearedStage: SavedQueueStageIdentity | null
    }
    unsolvedRemainder: (SavedQueueStageIdentity & {
      reason:
        'prior-stage-uncleared' | 'no-allocation' | 'outside-season-horizon'
    })[]
    sequenceLimitReached: boolean
  }
  warnings: (
    | 'fallback-stage-duration'
    | 'conditional-stage-progression'
    | 'no-damage-signal'
    | 'horizon-truncated'
    | 'stage-limit-reached'
  )[]
}

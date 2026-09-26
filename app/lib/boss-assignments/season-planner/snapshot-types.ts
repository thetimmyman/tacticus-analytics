import type { EncounterId } from '@/app/lib/boss-assignments/season-planner/identifiers'

export interface PlanFromNowEncounterSnapshot {
  encounterId: EncounterId
  targetUid: string
  targetLabel: string
  stageCode: string
  loopIndex: number
  bossName: string
  maxHp: number
  remainingHp: number
  seededFromMax: boolean
  confidence: 'high' | 'low'
}

export interface PlanFromNowSnapshot {
  snapshotAt: string
  guildCode: string
  season: string
  seasonId: string | null
  stageCode: string
  loopIndex: number
  advancedStage: boolean
  encounters: {
    main: PlanFromNowEncounterSnapshot
    prime1: PlanFromNowEncounterSnapshot
    prime2: PlanFromNowEncounterSnapshot
  }
  warnings: string[]
}

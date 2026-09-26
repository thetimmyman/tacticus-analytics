import { NUM_WARS_PER_SEASON } from '@/app/lib/war/guild-war-parser'

export const WAR_TIMING = {
  PREP_PHASE_MS: 24 * 60 * 60 * 1000,
  ACTIVE_PHASE_MS: 36 * 60 * 60 * 1000,
  ESTIMATED_SEASON_BREAK_MS: 21 * 24 * 60 * 60 * 1000,
  WARS_PER_SEASON: NUM_WARS_PER_SEASON
} as const

export const TOTAL_WAR_DURATION_MS =
  WAR_TIMING.PREP_PHASE_MS + WAR_TIMING.ACTIVE_PHASE_MS

export type WarPhase = 'prep' | 'active' | 'between_wars' | 'between_seasons'
export type WarPhaseSource = 'match_schedule' | 'estimated'

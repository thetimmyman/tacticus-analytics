import 'server-only'
import type { BombCalculationMode } from '@/app/lib/tacticus/bomb-damage'

export const DEFAULT_RARITY_FILTER = ['Legendary', 'Mythic']
export const DEFAULT_RECENCY_WINDOW_MS = 15 * 60 * 1000
export const HERALD_WEBHOOK_TYPE = 'herald'
export const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/
export const CHANNEL_FANOUT_DELAY_MS = 1000
export const COMBINE_PRIME_WINDOW_MS = 60 * 1000
export type HeraldPingMode = 'combined' | 'per_side' | 'skip_all'

export interface HeraldBattle {
  type?: string | null
  encounterIndex?: number | string | null
  completedOn?: number | null
  remainingHp?: number | null
  maxHp?: number | null
  rarity?: string | null
  userId?: string | null
  displayName?: string | null
  tier?: number | string | null
  set?: number | string | null
  Season?: number | string | null
  loopIndex?: number | string | null
}

export interface DefeatTransition {
  boss_id: string
  boss_type: string
  boss_display_name: string
  rarity: string
  tier: number | null
  set: number | null
  completed_on: number
  killer_display_name: string | null
  killer_user_id: string | null
  season: number | null
  loop_index: number
}

export interface AvailabilityTransition {
  boss_id: string
  boss_type: string
  boss_display_name: string
  rarity: string
  tier: number | null
  set: number | null
  encounter_index: number
  season: number
  // Later rotation wraps must post separately.
  loop_index: number
}

export interface BombRangeTransition {
  boss_id: string
  boss_type: string
  boss_display_name: string
  rarity: string
  tier: number | null
  set: number | null
  encounter_index: number
  season: number
  loop_index: number
  remaining_hp: number
  bombs_available: number
  bombs_needed: number
  overkill_threshold: number
  // Still posts, as a "do not bomb" advisory.
  under_kill_threshold: boolean
  kill_threshold_pct: number | null
  guild_level: number | null
  mode: BombCalculationMode
  damage_per_bomb: number
  damage_range: { floor: number; ceil: number }
  scenarios: {
    worst_case: { bombs_needed: number; damage_per_bomb: number }
    average: { bombs_needed: number; damage_per_bomb: number }
    best_case: { bombs_needed: number; damage_per_bomb: number }
  }
  observed_at: number
}

export interface BossConfigExtraEntry {
  label: string
  url: string
}

export interface ReplayRow {
  id: string
  source?: 'video' | 'interactive'
  // Playbook slug, not a transition bossId like Magnus_E0.
  boss_id: string | null
  title: string | null
  video_url: string | null
  video_type: string | null
  is_featured: boolean | null
  meta_team_name: string | null
  season: string | null
  units?: string[]
  damage?: number | null
  difficulty?: string | null
  description?: string | null
}

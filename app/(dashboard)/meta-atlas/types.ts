import type { StrengthState } from '@/app/lib/meta/roster-strength'
import type {
  MetaTeamProgression,
  TeamInfo,
  UpgradeStep
} from '@/app/lib/meta/types'

export type { MetaTeamProgression, TeamInfo, UpgradeStep }

export interface CurrentSeasonBoss {
  boss_type: string
  boss_name: string
  boss_unit_id?: string
  canonical?: string
}

export interface MetaFilters {
  bosses: string[]
  current_season_bosses: CurrentSeasonBoss[]
  /** All-time superset across seasons. */
  rarity_sets: string[]
  /** Sets with data, by season (e.g. "98" -> ["L1",…,"M1"]). */
  rarity_sets_by_season: Record<string, string[]>
  seasons: string[]
  meta_teams: string[]
  current_season: string | null
  previous_season: string | null
  season_number: number | null
}

export interface BossRecommendation {
  team_hash: string
  team_composition: string
  meta_team: string | null
  rarity_set: string | null
  sub_boss_name: string | null
  encounter_index: number
  damage_p90: number
  damage_p75: number
  damage_max: number
  damage_avg: number
  attack_count: number
  season: string
}

export interface PlayerCurrentTeamsResponse {
  player_name: string
  guild_code: string
  season: string
  current_teams: Array<{
    boss_name: string
    boss_type: string
    rarity: string
    rarity_set: string | null
    encounter_index: number | null
    encounter_type: string | null
    current_team: string
    current_team_hash: string
    attack_count: number
    avg_damage: number
    last_battle_time: string | null
    meta_team: string | null
  }>
  message?: string
}

export interface RosterRoiEntry {
  hero_name: string
  unlock_count: number
  total_damage_gain: number
  bosses: string[]
  investment_state?: StrengthState | null
}

export interface RosterRoiResponse {
  season: string
  results: RosterRoiEntry[]
  message?: string
}

export interface BossData {
  boss_type: string
  boss_name: string
  boss_lookup_name: string
  rarity_set: string
  encounter_index: number
  recommendations: BossRecommendation[]
  loading: boolean
  error: string | null
  current_team?: string | null
  current_team_info?: TeamInfo | null
  target_team?: string | null
  target_team_info?: TeamInfo | null
  best_buildable_team?: string | null
  best_buildable_info?: TeamInfo | null
  best_buildable_is_suitable?: boolean | null
  is_optimal?: boolean
  is_optimal_from_history?: boolean
  is_optimal_from_roster?: boolean
  history_equals_roster?: boolean
  optimal_message?: string | null
  upgrade_path?: UpgradeStep[]
  upgrade_path_from_history?: UpgradeStep[]
  upgrade_path_from_roster?: UpgradeStep[]
  total_damage_increase?: number
  total_damage_increase_from_history?: number
  total_damage_increase_from_roster?: number
  meta_team_progressions?: MetaTeamProgression[]
  progression_message?: string | null
  progression_error?: string | null
}

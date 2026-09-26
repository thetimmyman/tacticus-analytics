import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import type {
  MetaTeamProgression,
  TeamInfo,
  UpgradeStep
} from '@/app/lib/meta/types'

export type DagSupabaseClient = SupabaseClient<Database>

export type DagProgressionInput = {
  bossType?: string | null
  bossUnitId?: string | null
  encounterIndex?: number | null
  raritySet?: string | null
  season?: string | null
  currentTeam?: string | null
  currentTeamHash?: string | null
  roster?: RosterInputEntry[] | null
  minAttacks?: number
}

export type DagProgressionResult = {
  boss_type: string | null
  boss_unit_id: string | null
  filters: {
    rarity_set: string | null
    season: string | null
    encounter_index: number | null
    min_attacks: number
  }
  team_count: number
  edge_count: number
  dag: { source: 'meta_atlas_dag_edges'; edges: number }
  current_team: string | null
  target_team: string | null
  current_team_info: TeamInfo | null
  target_team_info: TeamInfo | null
  best_buildable_team: string | null
  best_buildable_info: TeamInfo | null
  best_buildable_is_suitable: boolean | null
  is_optimal: boolean
  is_optimal_from_history: boolean
  is_optimal_from_roster: boolean
  history_equals_roster: boolean
  optimal_message: string | null
  upgrade_path: UpgradeStep[]
  upgrade_path_from_history: UpgradeStep[]
  upgrade_path_from_roster: UpgradeStep[]
  upgrade_paths: LegacyUpgradeStep[]
  progression_path: LegacyUpgradeStep[]
  total_damage_increase: number
  total_damage_increase_from_history: number
  total_damage_increase_from_roster: number
  final_team: string | null
  meta_team_progressions?: MetaTeamProgression[]
  message?: string
}

export type DagProgressionError = { error: string }

export type MetaAtlasTeamRow = {
  team_hash: string
  team_composition: string | null
  meta_team: string | null
  damage_p90: number | null
  attack_count: number | null
  boss_type: string
  boss_unit_id: string | null
  encounter_index: number | null
  rarity_set: string | null
  season: string
}

export type DagEdgeRow = {
  from_team_hash: string
  to_team_hash: string
  swapped_out: string
  swapped_in: string
  from_damage_p90: number | null
  to_damage_p90: number | null
  damage_gain: number | null
}

export type LegacyUpgradeStep = {
  from_team: string
  to_team: string
  swapped_out: string
  swapped_in: string
  damage_increase: number
  percent_increase: number
  new_damage_p90: number
  meta_team: string | null
}

export type TeamWithOwnership = {
  team_hash: string
  composition: string
  meta_team: string | null
  damage_p90: number
  all_heroes_owned: boolean
  all_heroes_buildable: boolean
}

export type TeamEntry = {
  team_hash: string
  composition: string
  metaTeam: string | null
  damageP90: number
}

export type HeroScoreEntry = {
  name: string
  score: number
  isMow: boolean
}

export type RosterUnitMaps = {
  heroMap: Map<string, string>
  mowMap: Map<string, string>
  ownedUnits: Set<string>
}

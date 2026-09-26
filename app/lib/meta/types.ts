import type {
  OwnershipState,
  StrengthState,
  StrengthThresholds
} from '@/app/lib/meta/roster-strength'

export type TeamInfo = {
  id: string
  composition: string
  damage_p90: number
  meta_team: string | null
}

export type UpgradeStep = {
  step_index: number
  from_team: string
  to_team: string
  swapped_out: string
  swapped_in: string
  swap_out: string
  swap_in: string
  damage_increase: number
  damage_gain: number
  percent_increase: number
  new_damage_p90: number
  meta_team: string | null
  is_owned: boolean | null
  ownership_state?: OwnershipState | null
  strength_state?: StrengthState | null
  power?: number | null
  power_source?: 'provided' | 'derived' | null
  required_power?: number | null
  strength_score?: number | null
  threshold_source?: StrengthThresholds['source'] | null
  next_node_id: string
}

export type MetaTeamProgressionState = StrengthState | 'Owned'

export type MetaTeamProgression = {
  meta_team: string | null
  target_team: TeamInfo | null
  lowest_buildable_team: TeamInfo | null
  best_buildable_team: TeamInfo | null
  upgrade_path: UpgradeStep[]
  total_damage_increase: number
  worst_state: MetaTeamProgressionState | null
  is_buildable: boolean
}

import type { DagProgressionInput, DagProgressionResult } from './types'

type ResolvedDagInput = Required<DagProgressionInput>

export function emptyDagProgressionResult(
  input: ResolvedDagInput,
  options: {
    currentTeam?: string | null
    targetTeam?: string | null
    message: string
  }
): DagProgressionResult {
  return {
    boss_type: input.bossType,
    boss_unit_id: input.bossUnitId,
    filters: {
      rarity_set: input.raritySet,
      season: input.season,
      encounter_index: input.encounterIndex,
      min_attacks: input.minAttacks
    },
    team_count: 0,
    edge_count: 0,
    dag: { source: 'meta_atlas_dag_edges', edges: 0 },
    current_team: options.currentTeam ?? null,
    target_team: options.targetTeam ?? null,
    current_team_info: null,
    target_team_info: null,
    best_buildable_team: null,
    best_buildable_info: null,
    best_buildable_is_suitable: null,
    is_optimal: false,
    is_optimal_from_history: false,
    is_optimal_from_roster: false,
    history_equals_roster: true,
    optimal_message: null,
    upgrade_path: [],
    upgrade_path_from_history: [],
    upgrade_path_from_roster: [],
    upgrade_paths: [],
    progression_path: [],
    total_damage_increase: 0,
    total_damage_increase_from_history: 0,
    total_damage_increase_from_roster: 0,
    final_team: null,
    message: options.message
  }
}

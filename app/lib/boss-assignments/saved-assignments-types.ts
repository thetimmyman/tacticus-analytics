export interface SavedAssignmentIntent {
  player_id: string
  display_name: string
  primary_boss: string | null
  secondary_boss: string | null
  token_allocations: Record<string, number> | null
  uses_flexible_tokens: boolean | null
  total_tokens_allocated: number | null
  assigned_at: string | null
  updated_at: string | null
}

export interface SavedBossChoice {
  level: string
  boss_name: string
  sub_bosses: Record<string, unknown> | null
  selected_at: string | null
}

/** Persisted intent only. It does not remember a calculation's as-of instant. */
export interface SavedAssignments {
  source: 'saved-local'
  season: string
  assignments: SavedAssignmentIntent[]
  bosses: SavedBossChoice[]
  canReplace: boolean
  canClear: boolean
}

export interface ReplacementSummary {
  assignedCount: number
  totalPlayers: number
  totalTokens: number
}

export interface ClearSummary {
  assignmentsDeleted: number
  bossesDeleted: number
}

export type SavedAssignmentResult = SavedAssignments & {
  summary?: ReplacementSummary
  deleted?: ClearSummary
}

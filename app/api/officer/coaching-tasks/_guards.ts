export type CoachingTaskStatus =
  'open' | 'acknowledged' | 'dismissed' | 'resolved'
export type PatchableCoachingTaskStatus = Exclude<CoachingTaskStatus, 'open'>

export const ACTIVE_STATUSES: CoachingTaskStatus[] = ['open', 'acknowledged']

export const VALID_STATUSES = new Set<PatchableCoachingTaskStatus>([
  'acknowledged',
  'dismissed',
  'resolved'
])

export const VALID_RESOLUTIONS = new Set([
  'swapped_improved',
  'swapped_no_change',
  'execution_improved',
  'execution_no_change',
  'not_swapped'
])

export const COACHING_TASK_LIST_SELECT =
  'id, guild_code, display_name, season, boss_type, encounter_index, rarity_set, ' +
  'classification, confidence, ready_now_upside, used_team_hash, recommended_team_hash, ' +
  'recommended_swaps, original_actual_avg, source_battle_count, status, ' +
  'resolution, created_at, updated_at, resolved_at'

export interface CoachingTaskRow {
  id: string
  guild_code: string
  display_name: string
  season: string
  boss_type: string
  encounter_index: number
  rarity_set: string | null
  classification: string
  confidence: string
  ready_now_upside: number | null
  used_team_hash: string
  recommended_team_hash: string
  recommended_swaps: unknown
  original_actual_avg: number | null
  source_battle_count: number
  status: CoachingTaskStatus
  resolution: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export function coachingTaskExpectsTeamSwap(
  row: Pick<CoachingTaskRow, 'classification'>
): boolean {
  return row.classification === 'needs_support_wrong_team'
}

export function validateCoachingTaskTransition(
  current: CoachingTaskStatus,
  next: PatchableCoachingTaskStatus
): string | null {
  if (current === 'dismissed' || current === 'resolved') {
    return 'Coaching task is already closed'
  }
  if (
    next === 'acknowledged' &&
    current !== 'open' &&
    current !== 'acknowledged'
  ) {
    return 'Only open coaching tasks can be acknowledged'
  }
  return null
}

export function validateCoachingTaskResolution(
  status: PatchableCoachingTaskStatus,
  resolution: string | undefined
): string | null {
  if (status !== 'resolved') return null
  if (!resolution || !VALID_RESOLUTIONS.has(resolution)) {
    return 'resolution required when resolving'
  }
  return null
}

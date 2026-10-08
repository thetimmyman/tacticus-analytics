import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import type { HeraldBattle } from './contracts'

export interface RunHeraldForSyncParams {
  supabase: ServiceSupabaseClient
  guildCode: string
  battles: HeraldBattle[]
  /** All battles seen this sync. When omitted, availability detection is skipped. */
  allBattles?: HeraldBattle[]
  nowMs?: number
  bombsAvailableOverride?: number
}

export interface HeraldRunResult {
  invocation_id: string
  detected: number
  posted: number
  deduped: number
  failed: number
  availability_detected: number
  availability_posted: number
  availability_deduped: number
  availability_failed: number
  bomb_range_detected: number
  bomb_range_posted: number
  bomb_range_deduped: number
  bomb_range_failed: number
  skipped_reason: string | null
}

export const createEmptyHeraldRunResult = (
  invocationId = '',
  skippedReason: string | null = null
): HeraldRunResult => ({
  invocation_id: invocationId,
  detected: 0,
  posted: 0,
  deduped: 0,
  failed: 0,
  availability_detected: 0,
  availability_posted: 0,
  availability_deduped: 0,
  availability_failed: 0,
  bomb_range_detected: 0,
  bomb_range_posted: 0,
  bomb_range_deduped: 0,
  bomb_range_failed: 0,
  skipped_reason: skippedReason
})

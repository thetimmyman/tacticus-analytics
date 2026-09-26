/** Time-phased token availability so solver allocations respect regen, not a scalar pool. */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'
import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

/** Fresh guilds' stages must not all start "now". */
export const DEFAULT_STAGE_DURATION_SECONDS = 12 * 60 * 60

export interface StageKillDurationMedian {
  stageCode: string
  loopIndex: number
  medianSeconds: number
  sampleCount: number
  source: 'current_season' | 'rolling_window'
}

function stageKey(stageCode: string, loopIndex: number): string {
  return `${stageCode}|${loopIndex}`
}

export async function loadStageKillDurationMedians(
  supabase: SupabaseClient,
  guildCode: string,
  currentSeason: number,
  windowDays = 60
): Promise<Map<string, StageKillDurationMedian>> {
  const { data, error } = await supabase.rpc(
    'get_stage_kill_duration_medians',
    {
      p_guild_code: guildCode,
      p_current_season: currentSeason,
      p_window_days: windowDays
    }
  )

  if (error) {
    throw new Error(
      `Failed to load stage kill-duration medians: ${error.message}`
    )
  }

  const rows = (data ?? []) as Array<{
    stage_code: string
    loop_index: number
    median_seconds: number
    sample_count: number
    source: 'current_season' | 'rolling_window'
  }>

  const medians = new Map<string, StageKillDurationMedian>()
  for (const row of rows) {
    if (row.source !== 'rolling_window') continue
    medians.set(stageKey(row.stage_code, row.loop_index), {
      stageCode: row.stage_code,
      loopIndex: row.loop_index,
      medianSeconds: row.median_seconds,
      sampleCount: row.sample_count,
      source: 'rolling_window'
    })
  }
  for (const row of rows) {
    if (row.source !== 'current_season') continue
    medians.set(stageKey(row.stage_code, row.loop_index), {
      stageCode: row.stage_code,
      loopIndex: row.loop_index,
      medianSeconds: row.median_seconds,
      sampleCount: row.sample_count,
      source: 'current_season'
    })
  }

  return medians
}

export interface StageStartProjection {
  stageCode: string
  loopIndex: number
  startSeconds: number
  inboundDurationSeconds: number | null
  inboundDurationSource: 'current_season' | 'rolling_window' | 'fallback' | null
}

export function projectStageStartSeconds(
  sequence: ReadonlyArray<Pick<BossStageEntry, 'stageCode' | 'loopIndex'>>,
  medians: ReadonlyMap<string, StageKillDurationMedian>
): StageStartProjection[] {
  const out: StageStartProjection[] = []
  let cursor = 0

  for (let i = 0; i < sequence.length; i++) {
    const stage = sequence[i]!
    if (i === 0) {
      out.push({
        stageCode: stage.stageCode,
        loopIndex: stage.loopIndex,
        startSeconds: 0,
        inboundDurationSeconds: null,
        inboundDurationSource: null
      })
      continue
    }

    const prev = sequence[i - 1]!
    const prevMedian = medians.get(stageKey(prev.stageCode, prev.loopIndex))
    const inboundDurationSeconds =
      prevMedian?.medianSeconds ?? DEFAULT_STAGE_DURATION_SECONDS
    const inboundDurationSource: StageStartProjection['inboundDurationSource'] =
      prevMedian ? prevMedian.source : 'fallback'

    cursor += inboundDurationSeconds
    out.push({
      stageCode: stage.stageCode,
      loopIndex: stage.loopIndex,
      startSeconds: cursor,
      inboundDurationSeconds,
      inboundDurationSource
    })
  }

  return out
}

/**
 * min(MAX_TOKENS, current - allocated_before(t) + floor((t - now)/12h)), clamped at 0;
 * allocated_before prevents double-spending the bank.
 */
export function tokensAt(args: {
  currentTokens: number
  allocatedBefore: number
  elapsedSeconds: number
  maxTokens?: number
  regenSeconds?: number
}): number {
  const max = args.maxTokens ?? MAX_TOKENS
  const regen = args.regenSeconds ?? TWELVE_HOURS_IN_SECONDS
  const elapsed = Math.max(0, args.elapsedSeconds)
  const regenAccrued = Math.floor(elapsed / regen)
  const remaining = args.currentTokens - args.allocatedBefore + regenAccrued
  if (remaining <= 0) return 0
  if (remaining >= max) return max
  return remaining
}

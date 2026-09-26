// Shared by client and server: keep free of 'use client' and 'server-only'.

import type { SeasonForecastLapProjection } from '@/app/lib/season-forecast/forecast-service'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'

export interface MergedLapProjection extends SeasonForecastLapProjection {
  finish_source?: 'rotation_sim'
}

/** The sim owns `projected_finish_*` + `confidence`; the envelope owns the rest. */
export function mergeLapProjection(
  envLp: SeasonForecastLapProjection | null,
  outlook: SeasonOutlookProjection | null
): MergedLapProjection | null {
  if (!envLp) return null
  if (!outlook?.finish) return envLp
  return {
    ...envLp,
    projected_finish_lap: outlook.finish.loopIndex,
    projected_finish_pct: outlook.finish.pctIntoFinalStage,
    confidence: outlook.confidence,
    finish_source: 'rotation_sim'
  }
}

export function finishFromRotationSim(
  lp: SeasonForecastLapProjection
): boolean {
  return 'finish_source' in lp && lp.finish_source === 'rotation_sim'
}

/** The sim is cached ~15min, so live `current_lap` can overtake its finish; never true for raw RPC data. */
export function finishIsStale(lp: SeasonForecastLapProjection): boolean {
  return finishFromRotationSim(lp) && lp.current_lap > lp.projected_finish_lap
}

/** 0-based. On shortfall the RPC reports `current_lap − 1` with the current lap's pct, so clamp. */
export function displayFinishLap(lp: SeasonForecastLapProjection): number {
  return Math.max(lp.current_lap, lp.projected_finish_lap)
}

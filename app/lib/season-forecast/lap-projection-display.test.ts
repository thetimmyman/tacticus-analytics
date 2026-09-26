import { describe, it, expect } from 'vitest'
import {
  displayFinishLap,
  finishFromRotationSim,
  finishIsStale,
  mergeLapProjection
} from '@/app/lib/season-forecast/lap-projection-display'
import { lapFeasibilityTone } from '@/app/lib/season-forecast/boss-feasibility-math'
import type { SeasonForecastLapProjection } from '@/app/lib/season-forecast/forecast-service'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'

function lp(
  over: Partial<SeasonForecastLapProjection> = {}
): SeasonForecastLapProjection {
  return {
    current_lap: 4,
    tokens_into_current_lap: 6,
    projected_lap_cost: 10,
    basis: 'last_n_laps',
    n: 2,
    projected_finish_lap: 4,
    projected_finish_pct: 0.6,
    confidence: 'medium',
    ...over
  }
}

function outlook(
  over: Partial<SeasonOutlookProjection> = {}
): SeasonOutlookProjection {
  return {
    guildCode: 'ABCD',
    season: 105,
    generatedAt: '2026-06-19T00:00:00.000Z',
    secondsRemaining: 8 * 24 * 3600,
    memberCount: 30,
    seasonMaxTokensPerPlayer: 28,
    seasonBudget: 840,
    tokensUsed: 190,
    tokensRemaining: 650,
    projectedWaste: 120,
    playersAtCapRisk: 4,
    projectedForwardSpend: 530,
    finish: {
      stageCode: 'C4',
      bossName: 'Screamer Killer',
      loopIndex: 5,
      pctIntoFinalStage: 0.42,
      bossesDefeatedForward: 12
    },
    confidence: 'high',
    ...over
  }
}

describe('displayFinishLap', () => {
  it('clamps the shortfall (finish_lap = cur-1) up to the current lap', () => {
    expect(
      displayFinishLap(lp({ current_lap: 4, projected_finish_lap: 3 }))
    ).toBe(4)
  })
  it('passes through finish_lap when it equals the current lap', () => {
    expect(
      displayFinishLap(lp({ current_lap: 4, projected_finish_lap: 4 }))
    ).toBe(4)
  })
  it('passes through a finish ahead of the current lap', () => {
    expect(
      displayFinishLap(lp({ current_lap: 4, projected_finish_lap: 9 }))
    ).toBe(9)
  })
  it('WI-4480: every surface renders the 0-based value as +1 ("lap N")', () => {
    // The SeasonFeasibilityCard bug was rendering the 0-based lap bare.
    expect(
      displayFinishLap(lp({ current_lap: 5, projected_finish_lap: 6 })) + 1
    ).toBe(7)
  })
})

describe('mergeLapProjection', () => {
  it('returns null when there is no envelope lap projection to anchor on', () => {
    expect(mergeLapProjection(null, outlook())).toBeNull()
  })

  it('keeps the envelope unchanged when the sim has no finish', () => {
    const env = lp()
    expect(mergeLapProjection(env, outlook({ finish: null }))).toBe(env)
    expect(mergeLapProjection(env, null)).toBe(env)
  })

  it('overrides finish lap + pct + confidence from the sim, keeps current-lap fields', () => {
    const env = lp({
      current_lap: 1,
      tokens_into_current_lap: 30,
      projected_lap_cost: 147
    })
    const merged = mergeLapProjection(env, outlook())!
    expect(merged.projected_finish_lap).toBe(5)
    expect(merged.projected_finish_pct).toBeCloseTo(0.42)
    expect(merged.confidence).toBe('high')
    expect(merged.current_lap).toBe(1)
    expect(merged.tokens_into_current_lap).toBe(30)
    expect(merged.projected_lap_cost).toBe(147)
  })

  it('shortfall after merge: sim finish behind the live lap still clamps for display', () => {
    const env = lp({ current_lap: 7, projected_finish_lap: 6 })
    const merged = mergeLapProjection(
      env,
      outlook({ finish: { ...outlook().finish!, loopIndex: 6 } })
    )!
    expect(merged.projected_finish_lap).toBe(6)
    expect(displayFinishLap(merged)).toBe(7)
  })

  it('marks a merged projection as rotation-sim sourced; passthrough stays unmarked', () => {
    const env = lp()
    const merged = mergeLapProjection(env, outlook())!
    expect(finishFromRotationSim(merged)).toBe(true)
    expect(finishFromRotationSim(mergeLapProjection(env, null)!)).toBe(false)
    expect(finishFromRotationSim(env)).toBe(false)
  })
})

describe('finishIsStale', () => {
  it('true only for a rotation-sim merge whose finish fell behind the live lap', () => {
    const env = lp({ current_lap: 7, projected_finish_lap: 6 })
    const merged = mergeLapProjection(
      env,
      outlook({ finish: { ...outlook().finish!, loopIndex: 6 } })
    )!
    expect(finishIsStale(merged)).toBe(true)
  })

  it('false for a fresh merge and for a raw RPC shortfall', () => {
    expect(finishIsStale(mergeLapProjection(lp(), outlook())!)).toBe(false)
    expect(finishIsStale(lp({ current_lap: 7, projected_finish_lap: 6 }))).toBe(
      false
    )
  })
})

describe('feasibility tone under cache skew (SeasonFeasibilityCard input)', () => {
  const cardToneInput = (l: SeasonForecastLapProjection) =>
    finishFromRotationSim(l)
      ? { ...l, projected_finish_lap: displayFinishLap(l) }
      : l

  it('a skewed merged projection does not force at_risk once clamped', () => {
    const env = lp({ current_lap: 7, projected_finish_lap: 7 })
    const merged = mergeLapProjection(
      env,
      outlook({
        finish: {
          ...outlook().finish!,
          loopIndex: 6, // sim finish fell behind the live lap (cache skew)
          pctIntoFinalStage: 0.6
        }
      })
    )!
    // Unclamped, finish<current reads at_risk under an ahead-of-pace headline.
    expect(lapFeasibilityTone(merged)).toBe('at_risk')
    expect(lapFeasibilityTone(cardToneInput(merged))).not.toBe('at_risk')
    expect(lapFeasibilityTone(cardToneInput(merged))).toBe('watch')
  })

  it('a genuine RPC shortfall (non-merged) still tones at_risk', () => {
    const env = lp({
      current_lap: 7,
      projected_finish_lap: 6,
      projected_finish_pct: 0.8
    })
    expect(lapFeasibilityTone(cardToneInput(env))).toBe('at_risk')
  })
})

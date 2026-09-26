import { describe, it, expect } from 'vitest'
import {
  buildLapBars,
  finishIsComplete
} from '@/app/components/briefing/SeasonOutlookCard'
import {
  displayFinishLap,
  mergeLapProjection
} from '@/app/lib/season-forecast/lap-projection-display'
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

describe('finishIsComplete', () => {
  it('true when the pct rounds to a full lap (no contradictory +100%)', () => {
    expect(finishIsComplete(lp({ projected_finish_pct: 0.996 }))).toBe(true)
    expect(finishIsComplete(lp({ projected_finish_pct: 0.999 }))).toBe(true)
  })
  it('false below the rounding boundary', () => {
    expect(finishIsComplete(lp({ projected_finish_pct: 0.99 }))).toBe(false)
    expect(finishIsComplete(lp({ projected_finish_pct: 0.6 }))).toBe(false)
  })
})

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

describe('mergeLapProjection → lap chart integration', () => {
  it('the corrected projection drives a multi-lap chart (current=1 → finish=5)', () => {
    const env = lp({
      current_lap: 1,
      tokens_into_current_lap: 30,
      projected_lap_cost: 147
    })
    const merged = mergeLapProjection(env, outlook())!
    expect(displayFinishLap(merged)).toBe(5) // header "Lap 6"
    const bars = buildLapBars(merged)
    // window from cur-4 (clamped 0) up to min(finish, cur+4) = 5
    expect(bars.map((b) => b.lap)).toEqual([0, 1, 2, 3, 4, 5])
    expect(bars.find((b) => b.lap === 1)?.kind).toBe('live')
    expect(bars.find((b) => b.lap === 5)?.kind).toBe('finish')
  })
})

describe('buildLapBars', () => {
  it('shows recent completed laps as ✓ + the live lap (header lap === live bar lap)', () => {
    const bars = buildLapBars(
      lp({ current_lap: 4, projected_finish_lap: 4, projected_finish_pct: 0.6 })
    )
    expect(bars.map((b) => b.lap)).toEqual([0, 1, 2, 3, 4])
    const done = bars.slice(0, 4)
    expect(
      done.every((b) => b.kind === 'done' && b.solid === 1 && b.value === '✓')
    ).toBe(true)
    const live = bars[4]!
    expect(live.kind).toBe('live')
    expect(live.lap).toBe(4) // == displayFinishLap → header "Lap 5" matches bar "L5"
    expect(live.solid).toBeCloseTo(0.6) // tokens_into 6 / cost 10
    expect(live.value).toBe('6/10')
  })

  it('shortfall projection: live lap carries the pct, no contradictory ✓ finish bar', () => {
    const bars = buildLapBars(
      lp({ current_lap: 4, projected_finish_lap: 3, projected_finish_pct: 0.8 })
    )
    const live = bars[bars.length - 1]!
    expect(live.lap).toBe(4) // displayFinishLap clamps to current
    expect(live.kind).toBe('live')
    // Ghost = projected fill of the current lap (max of liveSolid, pct).
    expect(live.ghost).toBeCloseTo(0.8)
    // No standalone 'finish' bar: finish === cur lives on the live bar.
    expect(bars.some((b) => b.kind === 'finish')).toBe(false)
  })

  it('early laps: only as many bars as exist (cur=1 → 2 bars)', () => {
    const bars = buildLapBars(lp({ current_lap: 1, projected_finish_lap: 1 }))
    expect(bars.map((b) => b.lap)).toEqual([0, 1])
  })

  it('zero projected_lap_cost does not divide-by-zero', () => {
    const bars = buildLapBars(
      lp({
        current_lap: 0,
        projected_finish_lap: 0,
        projected_lap_cost: 0,
        tokens_into_current_lap: 3
      })
    )
    const live = bars[bars.length - 1]!
    expect(live.solid).toBe(0)
    expect(live.value).toBe('3')
  })

  it('WI-1950: keeps the finish bar + pct when the projection is >4 laps ahead', () => {
    const bars = buildLapBars(
      lp({
        current_lap: 1,
        projected_finish_lap: 7,
        projected_finish_pct: 0.42
      })
    )
    const finishBar = bars.find((b) => b.kind === 'finish')
    expect(finishBar).toBeDefined()
    expect(finishBar!.lap).toBe(7) // displays "L8"
    expect(finishBar!.value).toBe('42%')
    expect(bars.some((b) => b.kind === 'live' && b.lap === 1)).toBe(true)
    // The rightmost bar is the finish, never a stray 'projected' endpoint.
    expect(bars[bars.length - 1]!.kind).toBe('finish')
  })

  it('WI-1950: caps intermediate projected bars but still shows the finish', () => {
    const bars = buildLapBars(
      lp({
        current_lap: 0,
        projected_finish_lap: 12,
        projected_finish_pct: 0.1
      })
    )
    const projected = bars.filter((b) => b.kind === 'projected')
    expect(projected.length).toBeLessThanOrEqual(5)
    expect(bars[bars.length - 1]!.kind).toBe('finish')
    expect(bars[bars.length - 1]!.lap).toBe(12)
  })
})

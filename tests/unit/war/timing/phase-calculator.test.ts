import { describe, expect, it } from 'vitest'
import { WAR_TIMING } from '@/app/lib/war/timing/constants'
import {
  buildEstimatedPhaseFromMatch,
  buildPhaseFromMatch,
  extractWarNumbers,
  resolveWarWindow,
  type WarMatchTimingData
} from '@/app/lib/war/timing/phase-calculator'

const HOUR = 60 * 60 * 1000

const makeMatch = (
  overrides: Partial<WarMatchTimingData> = {}
): WarMatchTimingData => ({
  war_start_date: '2026-01-01T00:00:00Z',
  war_end_date: '2026-01-03T12:00:00Z', // 60h span: 24h prep + 36h active
  war_season: 4,
  raw_loki_data: { warNumber: 3, season: 4 },
  ...overrides
})

const END = Date.parse('2026-01-03T12:00:00Z')
const ACTIVE_START = END - WAR_TIMING.ACTIVE_PHASE_MS
const PREP_START = ACTIVE_START - WAR_TIMING.PREP_PHASE_MS

describe('extractWarNumbers', () => {
  it('prefers raw war numbers when available', () => {
    const match = makeMatch({ raw_loki_data: { warNumber: 3, season: 4 } })
    expect(extractWarNumbers(match)).toEqual({ warNumber: 3, seasonNumber: 4 })
  })

  it('derives season and war numbers from the Loki event id fallback', () => {
    const match = makeMatch({
      war_season: null,
      raw_loki_data: { lastGuildWarEventId: 14 }
    })
    expect(extractWarNumbers(match)).toEqual({ warNumber: 2, seasonNumber: 3 })
  })

  it('handles non-object raw data gracefully', () => {
    const match = makeMatch({
      war_season: null,
      raw_loki_data: 'not-an-object'
    })
    expect(extractWarNumbers(match)).toEqual({ warNumber: 0, seasonNumber: 0 })
  })
})

describe('resolveWarWindow', () => {
  it('anchors the window backwards from war_end_date', () => {
    expect(resolveWarWindow(makeMatch())).toEqual({
      prepStartMs: PREP_START,
      activeStartMs: ACTIVE_START,
      endMs: END,
      isEstimated: false
    })
  })

  it('extrapolates forward from war_start_date when the end is missing', () => {
    const start = Date.parse('2026-02-01T00:00:00Z')
    expect(
      resolveWarWindow(
        makeMatch({
          war_start_date: '2026-02-01T00:00:00Z',
          war_end_date: null
        })
      )
    ).toEqual({
      prepStartMs: start,
      activeStartMs: start + WAR_TIMING.PREP_PHASE_MS,
      endMs: start + WAR_TIMING.PREP_PHASE_MS + WAR_TIMING.ACTIVE_PHASE_MS,
      isEstimated: true
    })
  })

  it('returns null when both dates are missing', () => {
    expect(
      resolveWarWindow(makeMatch({ war_start_date: null, war_end_date: null }))
    ).toBeNull()
  })
})

describe('buildPhaseFromMatch', () => {
  it('walks between_wars → prep → active across the window', () => {
    const match = makeMatch()

    const beforePrep = buildPhaseFromMatch(match, PREP_START - HOUR)
    expect(beforePrep).toMatchObject({
      phase: 'between_wars',
      warNumber: 3,
      seasonNumber: 4,
      nextEventLabel: 'War 3 Prep Starts',
      source: 'match_schedule',
      isEstimated: false
    })

    const prep = buildPhaseFromMatch(match, PREP_START + 12 * HOUR)
    expect(prep).toMatchObject({
      phase: 'prep',
      nextEventLabel: 'War 3 Attacks Begin'
    })
    expect(prep?.nextEventTime.getTime()).toBe(ACTIVE_START)

    const active = buildPhaseFromMatch(match, ACTIVE_START + 12 * HOUR)
    expect(active).toMatchObject({
      phase: 'active',
      nextEventLabel: 'War 3 Ends'
    })
    expect(active?.nextEventTime.getTime()).toBe(END)
  })

  it('returns null once the war has ended', () => {
    expect(buildPhaseFromMatch(makeMatch(), END + 60 * 1000)).toBeNull()
  })

  it('marks a start-only window as estimated', () => {
    const match = makeMatch({
      war_start_date: '2026-02-01T00:00:00Z',
      war_end_date: null
    })
    const start = Date.parse('2026-02-01T00:00:00Z')
    const info = buildPhaseFromMatch(match, start + 2 * HOUR)
    expect(info).toMatchObject({
      phase: 'prep',
      isEstimated: true,
      sourceLabel: 'Match schedule (estimated)'
    })
  })

  it('returns null when match dates are invalid', () => {
    const match = makeMatch({ war_start_date: null, war_end_date: null })
    expect(
      buildPhaseFromMatch(match, Date.parse('2026-01-01T00:00:00Z'))
    ).toBeNull()
  })

  it('uses fallback labels when the war number is unknown', () => {
    const match = makeMatch({ war_season: null, raw_loki_data: undefined })
    const info = buildPhaseFromMatch(match, PREP_START - HOUR)
    expect(info?.nextEventLabel).toBe('Next War Prep Starts')
    expect(info?.seasonNumber).toBe(0)
  })
})

describe('buildEstimatedPhaseFromMatch', () => {
  it('returns null when the match has no usable dates', () => {
    const match = makeMatch({ war_start_date: null, war_end_date: null })
    expect(
      buildEstimatedPhaseFromMatch(match, Date.parse('2026-01-01T00:00:00Z'))
    ).toBeNull()
  })

  it('reports the live window with estimated source when now is inside it', () => {
    const info = buildEstimatedPhaseFromMatch(
      makeMatch(),
      ACTIVE_START + 12 * HOUR
    )
    expect(info).toMatchObject({
      phase: 'active',
      source: 'estimated',
      isEstimated: true
    })
  })

  it('rolls an estimated final war into the next season', () => {
    const finalWar = makeMatch({
      raw_loki_data: { warNumber: 6, season: 4 },
      war_season: null
    })
    const info = buildEstimatedPhaseFromMatch(finalWar, END + HOUR)
    expect(info).toMatchObject({
      phase: 'between_seasons',
      warNumber: 1,
      seasonNumber: 5,
      nextEventLabel: 'Season 5 Starts',
      isEstimated: true
    })
    expect(info?.nextEventTime.getTime()).toBe(
      END + WAR_TIMING.ESTIMATED_SEASON_BREAK_MS
    )
  })

  it('projects the next war when the season continues', () => {
    const info = buildEstimatedPhaseFromMatch(
      makeMatch({ raw_loki_data: { warNumber: 2, season: 4 } }),
      END + HOUR
    )
    expect(info).toMatchObject({
      phase: 'between_wars',
      warNumber: 3,
      nextEventLabel: 'War 3 Prep Starts'
    })
    expect(info?.nextEventTime.getTime()).toBe(END + WAR_TIMING.PREP_PHASE_MS)
  })

  it('rolls forward through multiple estimated wars when now is far past the end', () => {
    // An hour past War 3's estimated slot must land in War 4's between_wars gap.
    const info = buildEstimatedPhaseFromMatch(
      makeMatch({ raw_loki_data: { warNumber: 2, season: 4 } }),
      END + 85 * HOUR
    )
    expect(info).toMatchObject({
      phase: 'between_wars',
      warNumber: 4,
      nextEventLabel: 'War 4 Prep Starts'
    })
  })
})

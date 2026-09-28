import { describe, it, expect } from 'vitest'
import {
  selectSpendableCapFigures,
  selectCapRiskEntries,
  mergePlayerProjection
} from '@/app/lib/season-forecast/pace-figures'
import type { PlayerTokenPaceRow } from '@/app/lib/season-forecast/season-token-economy'
import type { SeasonForecastPlayerRow } from '@/app/lib/season-forecast/forecast-service'

const envelope = {
  spendableByEnd: 840,
  capBoundPlayers: 12,
  estimatedCapWaste: 30
}

describe('selectSpendableCapFigures', () => {
  it('uses the pace-model outlook figures when the outlook is present', () => {
    const figures = selectSpendableCapFigures({
      outlook: {
        tokensRemaining: 412,
        playersAtCapRisk: 3,
        projectedWaste: 7
      },
      envelope
    })
    expect(figures).toEqual({
      source: 'pace',
      spendableByEnd: 412,
      capBoundPlayers: 3,
      estimatedCapWaste: 7
    })
  })

  it('falls back to the envelope figures unchanged when the outlook is null', () => {
    const figures = selectSpendableCapFigures({ outlook: null, envelope })
    expect(figures).toEqual({
      source: 'envelope',
      spendableByEnd: 840,
      capBoundPlayers: 12,
      estimatedCapWaste: 30
    })
  })

  it('treats undefined outlook the same as null (optional prop default)', () => {
    const figures = selectSpendableCapFigures({
      outlook: undefined,
      envelope
    })
    expect(figures.source).toBe('envelope')
    expect(figures.spendableByEnd).toBe(840)
  })

  it('honors pace zeros — a 0 cap-risk outlook must not fall back', () => {
    const figures = selectSpendableCapFigures({
      outlook: {
        tokensRemaining: 0,
        playersAtCapRisk: 0,
        projectedWaste: 0
      },
      envelope
    })
    expect(figures).toEqual({
      source: 'pace',
      spendableByEnd: 0,
      capBoundPlayers: 0,
      estimatedCapWaste: 0
    })
  })
})

const paceRow = (
  over: Partial<PlayerTokenPaceRow> = {}
): PlayerTokenPaceRow => ({
  playerId: 'p1',
  displayName: 'Alpha',
  tokensUsed: 10,
  tokensRemaining: 17.4,
  projectedWaste: 4.6,
  atCapRisk: true,
  ...over
})

const envelopeRow = (
  over: Partial<SeasonForecastPlayerRow> = {}
): SeasonForecastPlayerRow => ({
  player_id: 'p1',
  display_name: 'Alpha',
  tokens_now: 2,
  next_token_seconds: 3600,
  tokens_will_regen: 1,
  tokens_at_season_end: 3,
  will_cap: false,
  estimated_cap_waste: 0,
  ...over
})

describe('selectCapRiskEntries', () => {
  it('selects the at-risk pace rows, rounded for display', () => {
    const selection = selectCapRiskEntries({
      paceRows: [
        paceRow(),
        paceRow({ playerId: 'p2', displayName: 'Beta', atCapRisk: false })
      ],
      envelopeRows: [envelopeRow({ will_cap: true, estimated_cap_waste: 9 })]
    })
    expect(selection.source).toBe('pace')
    expect(selection.entries).toEqual([
      { displayName: 'Alpha', estimatedCapWaste: 5 }
    ])
  })

  it('honors an EMPTY pace array over a modeled roster as authoritative nobody-at-risk', () => {
    const selection = selectCapRiskEntries({
      paceRows: [],
      paceMemberCount: 28,
      envelopeRows: [envelopeRow({ will_cap: true, estimated_cap_waste: 9 })]
    })
    expect(selection.source).toBe('pace')
    expect(selection.entries).toEqual([])
  })

  it('treats empty pace rows over an EMPTY modeled roster (memberCount 0) as a miss', () => {
    const selection = selectCapRiskEntries({
      paceRows: [],
      paceMemberCount: 0,
      envelopeRows: [envelopeRow({ will_cap: true, estimated_cap_waste: 9 })]
    })
    expect(selection.source).toBe('envelope')
    expect(selection.entries).toEqual([
      { displayName: 'Alpha', estimatedCapWaste: 9 }
    ])
  })

  it('falls back to the envelope will_cap rows when the outlook missed', () => {
    const selection = selectCapRiskEntries({
      paceRows: null,
      envelopeRows: [
        envelopeRow({ will_cap: true, estimated_cap_waste: 9 }),
        envelopeRow({
          player_id: 'p2',
          display_name: 'Beta',
          will_cap: false
        })
      ]
    })
    expect(selection.source).toBe('envelope')
    expect(selection.entries).toEqual([
      { displayName: 'Alpha', estimatedCapWaste: 9 }
    ])
  })
})

describe('mergePlayerProjection', () => {
  it('overlays pace projections while keeping envelope live facts', () => {
    const merged = mergePlayerProjection(envelopeRow(), paceRow())
    expect(merged).toEqual({
      player_id: 'p1',
      display_name: 'Alpha',
      tokens_now: 2,
      next_token_seconds: 3600,
      tokens_will_regen: 1,
      tokens_at_season_end: 17,
      will_cap: true,
      estimated_cap_waste: 5
    })
  })

  it('passes the envelope row through unchanged when the pace row is missing', () => {
    const envelope = envelopeRow()
    expect(mergePlayerProjection(envelope, null)).toBe(envelope)
    expect(mergePlayerProjection(envelope, undefined)).toBe(envelope)
  })

  it('returns null without an envelope row — pace alone has no live facts', () => {
    expect(mergePlayerProjection(null, paceRow())).toBeNull()
    expect(mergePlayerProjection(undefined, paceRow())).toBeNull()
  })
})

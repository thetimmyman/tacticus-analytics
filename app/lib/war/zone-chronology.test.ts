import { describe, expect, it } from 'vitest'
import {
  cleanupAttemptKey,
  crossCheckZoneEvents,
  detectCleanupAttempts,
  type ChronologyRow
} from './zone-chronology'

const win = (over: Partial<ChronologyRow>): ChronologyRow => ({
  war_id: 'w1',
  zone_id: 'z1',
  player_id: 'P1',
  attempt_result: 'win',
  defender_units_json: [{ remainingHPAfter: 0 }],
  attempt_end_time: '2026-01-01T00:00:00Z',
  ...over
})

const fail = (over: Partial<ChronologyRow>): ChronologyRow =>
  win({
    defender_units_json: [{ remainingHPAfter: 100 }],
    ...over
  })

describe('detectCleanupAttempts', () => {
  it('first win on a WEAKENED zone is the cleanup; the zone resets to FRESH', () => {
    const rows = [
      fail({ player_id: 'P1', attempt_end_time: '2026-01-01T00:00:01Z' }),
      win({ player_id: 'P2', attempt_end_time: '2026-01-01T00:00:02Z' }),
      win({ player_id: 'P3', attempt_end_time: '2026-01-01T00:00:03Z' })
    ]
    const cleanups = detectCleanupAttempts(rows)
    expect(cleanups.size).toBe(1)
    expect(cleanups.has(cleanupAttemptKey(rows[1]!))).toBe(true)
  })

  it('replays chronologically regardless of input order', () => {
    const rows = [
      win({ player_id: 'P2', attempt_end_time: '2026-01-01T00:00:02Z' }),
      fail({ player_id: 'P1', attempt_end_time: '2026-01-01T00:00:01Z' })
    ]
    const cleanups = detectCleanupAttempts(rows)
    expect(cleanups.has(cleanupAttemptKey(rows[0]!))).toBe(true)
  })

  it('tracks zones independently per war and per zone', () => {
    const rows = [
      fail({ war_id: 'w1', zone_id: 'z1', attempt_end_time: '1' }),
      win({ war_id: 'w2', zone_id: 'z1', attempt_end_time: '2' }),
      win({ war_id: 'w1', zone_id: 'z2', attempt_end_time: '3' })
    ]
    expect(detectCleanupAttempts(rows).size).toBe(0)
  })

  it('supports multiple weaken/cleanup cycles on one zone', () => {
    const rows = [
      fail({ attempt_end_time: '1' }),
      win({ player_id: 'P2', attempt_end_time: '2' }),
      fail({ attempt_end_time: '3' }),
      win({ player_id: 'P3', attempt_end_time: '4' })
    ]
    const cleanups = detectCleanupAttempts(rows)
    expect(cleanups.size).toBe(2)
  })

  it('ignores rows without a zone or without a Loki result', () => {
    const rows = [
      fail({ zone_id: null, attempt_end_time: '1' }),
      fail({ attempt_result: null, attempt_end_time: '2' }),
      win({ player_id: 'P2', attempt_end_time: '3' })
    ]
    expect(detectCleanupAttempts(rows).size).toBe(0)
  })
})

describe('crossCheckZoneEvents (C7 — positive control, directional invariant)', () => {
  const capturedRows = [
    win({ war_id: 'w1', zone_id: 'z1' }),
    fail({ war_id: 'w1', zone_id: 'z2' })
  ]

  it('skips (logged, not silent-clean) when there are zero zoneDestroyed events', () => {
    const res = crossCheckZoneEvents(capturedRows, [
      { war_id: 'w1', zone_id: 'z1', event_type: 'markTarget' }
    ])
    expect(res.skipped).toBe(true)
    expect(res.eventPopulation).toBe(1)
    expect(res.incompleteWarIds).toEqual([])
  })

  it('skips when EVERY zoneDestroyed event lost its zone_id (nullable FK) — never a confident clean over zero checks', () => {
    const res = crossCheckZoneEvents(capturedRows, [
      { war_id: 'w1', zone_id: null, event_type: 'zoneDestroyed' },
      { war_id: 'w1', zone_id: null, event_type: 'zoneDestroyed' }
    ])
    expect(res.skipped).toBe(true)
    expect(res.checkedEvents).toBe(0)
    expect(res.eventPopulation).toBe(2)
    expect(res.incompleteWarIds).toEqual([])
  })

  it('a zoneDestroyed event on a zone with a detected capture matches', () => {
    const res = crossCheckZoneEvents(capturedRows, [
      { war_id: 'w1', zone_id: 'z1', event_type: 'zoneDestroyed' }
    ])
    expect(res.skipped).toBe(false)
    expect(res.matchedEvents).toBe(1)
    expect(res.incompleteWarIds).toEqual([])
  })

  it('a zoneDestroyed event with NO detected capture marks the war incomplete', () => {
    const res = crossCheckZoneEvents(capturedRows, [
      { war_id: 'w1', zone_id: 'z-missing', event_type: 'zoneDestroyed' },
      { war_id: 'w2', zone_id: 'z9', event_type: 'zoneDestroyed' }
    ])
    expect(res.incompleteWarIds).toEqual(['w1', 'w2'])
    expect(res.checkedEvents).toBe(2)
    expect(res.matchedEvents).toBe(0)
  })

  it('failed attacks do not count as captures for the invariant', () => {
    const res = crossCheckZoneEvents(
      [fail({ war_id: 'w1', zone_id: 'z2' })],
      [{ war_id: 'w1', zone_id: 'z2', event_type: 'zoneDestroyed' }]
    )
    expect(res.incompleteWarIds).toEqual(['w1'])
  })

  it('reports the event population it examined (positive control)', () => {
    const res = crossCheckZoneEvents(capturedRows, [
      { war_id: 'w1', zone_id: 'z1', event_type: 'zoneDestroyed' },
      { war_id: 'w1', zone_id: 'z1', event_type: 'markTarget' },
      { war_id: 'w1', zone_id: 'z1', event_type: 'playerClaimedZone' }
    ])
    expect(res.eventPopulation).toBe(3)
  })
})

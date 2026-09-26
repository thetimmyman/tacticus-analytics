import { describe, it, expect } from 'vitest'
import {
  classifyMemberBoss,
  CLASSIFIER,
  type ClassifierInput
} from '@/app/lib/officer-briefing/classifier'

function base(overrides: Partial<ClassifierInput> = {}): ClassifierInput {
  return {
    actualAvg: 800_000,
    expectedForUsedTeam: 850_000,
    expectedForBestFieldable: 870_000,
    battleCount: 6,
    bestFieldableDiffersFromUsed: false,
    rosterStale: false,
    ...overrides
  }
}

describe('classifyMemberBoss', () => {
  it('insufficient_data when battleCount below MIN_ATTACKS', () => {
    const r = classifyMemberBoss(base({ battleCount: 1 }))
    expect(r.classification).toBe('insufficient_data')
    expect(r.confidence).toBe('low')
  })

  it('battleCount 2 yields a low-confidence verdict, not insufficient_data (floor = 2)', () => {
    const r = classifyMemberBoss(base({ battleCount: 2 }))
    expect(r.classification).not.toBe('insufficient_data')
    expect(r.confidence).toBe('low')
  })

  it('insufficient_data when actualAvg is null', () => {
    const r = classifyMemberBoss(base({ actualAvg: null }))
    expect(r.classification).toBe('insufficient_data')
  })

  it('doing_great when actual is materially above best-fieldable expectation', () => {
    const r = classifyMemberBoss(
      base({ actualAvg: 1_000_000, expectedForBestFieldable: 850_000 })
    )
    expect(r.classification).toBe('doing_great')
    expect(r.recommendation.toLowerCase()).toContain('recognize')
  })

  it('needs_support_wrong_team when a meaningfully better team is fieldable and differs', () => {
    const r = classifyMemberBoss(
      base({
        actualAvg: 600_000,
        expectedForUsedTeam: 650_000,
        expectedForBestFieldable: 1_050_000, // >5% selection gap
        bestFieldableDiffersFromUsed: true
      })
    )
    expect(r.classification).toBe('needs_support_wrong_team')
    expect(r.readyNowUpside).toBe(450_000)
    expect(r.recommendation).toContain('stronger team is available now')
  })

  it('equivalence margin: a tiny selection gap is NOT wrong-team', () => {
    const r = classifyMemberBoss(
      base({
        actualAvg: 600_000,
        expectedForUsedTeam: 850_000, // big execution gap
        expectedForBestFieldable: 870_000, // only ~2.4% selection gap < 5%
        bestFieldableDiffersFromUsed: true
      })
    )
    expect(r.classification).toBe('needs_support_correct_team')
  })

  it('stale roster hard-suppresses the wrong-team recommendation', () => {
    const r = classifyMemberBoss(
      base({
        actualAvg: 600_000,
        expectedForUsedTeam: 650_000,
        expectedForBestFieldable: 1_050_000,
        bestFieldableDiffersFromUsed: true,
        rosterStale: true
      })
    )
    expect(r.classification).not.toBe('needs_support_wrong_team')
  })

  it('needs_support_correct_team when underplaying the best team they can field', () => {
    const r = classifyMemberBoss(
      base({
        actualAvg: 600_000,
        expectedForUsedTeam: 850_000, // ~29% execution gap ≥ 15%
        expectedForBestFieldable: 860_000, // <5% selection gap
        bestFieldableDiffersFromUsed: false
      })
    )
    expect(r.classification).toBe('needs_support_correct_team')
    expect(r.recommendation.toLowerCase()).toContain('execution')
  })

  it('roster_limited when no better team and playing it about as well as the population → suppressed', () => {
    const r = classifyMemberBoss(
      base({
        actualAvg: 820_000,
        expectedForUsedTeam: 850_000, // ~3.5% execution gap < 15%
        expectedForBestFieldable: 855_000, // <5% selection gap
        bestFieldableDiffersFromUsed: false
      })
    )
    expect(r.classification).toBe('roster_limited')
  })

  it('wrong-team confidence is high only with enough attacks', () => {
    const wrong = base({
      actualAvg: 600_000,
      expectedForUsedTeam: 650_000,
      expectedForBestFieldable: 1_050_000,
      bestFieldableDiffersFromUsed: true
    })
    expect(classifyMemberBoss({ ...wrong, battleCount: 6 }).confidence).toBe(
      'high'
    )
    expect(classifyMemberBoss({ ...wrong, battleCount: 4 }).confidence).toBe(
      'medium'
    )
  })

  it('exposes both gaps for the detail panel', () => {
    const r = classifyMemberBoss(
      base({
        actualAvg: 600_000,
        expectedForUsedTeam: 700_000,
        expectedForBestFieldable: 900_000
      })
    )
    expect(r.executionGap).toBe(100_000)
    expect(r.selectionGap).toBe(200_000)
  })

  it('constants are sane (margin < tau, recognize positive)', () => {
    expect(CLASSIFIER.SELECTION_MARGIN).toBeLessThan(CLASSIFIER.EXECUTION_TAU)
    expect(CLASSIFIER.RECOGNIZE_EPS).toBeGreaterThan(0)
    expect(CLASSIFIER.MIN_ATTACKS).toBeGreaterThanOrEqual(2)
  })
})

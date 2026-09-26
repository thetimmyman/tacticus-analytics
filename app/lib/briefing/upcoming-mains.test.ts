import { describe, it, expect } from 'vitest'
import { buildUpcomingMains } from '@/app/lib/briefing/upcoming-mains'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'
import type { StageStartProjection } from '@/app/lib/boss-assignments/stage-timing'

const HOUR = 3600

function stage(stageCode: string, bossType: string): BossStageEntry {
  return {
    stageCode,
    loopIndex: 0,
    encounters: {
      main: {
        bossName: bossType.toLowerCase(),
        bossType,
        maxHp: 100,
        remainingHp: 100
      },
      prime1: null,
      prime2: null
    },
    estimatedTokensNeeded: 0,
    difficulty: 'medium',
    isCurrentStage: false
  }
}

function proj(
  startSeconds: number,
  inboundDurationSeconds: number | null = null,
  inboundDurationSource: StageStartProjection['inboundDurationSource'] = null
): StageStartProjection {
  return {
    stageCode: 'x',
    loopIndex: 0,
    startSeconds,
    inboundDurationSeconds,
    inboundDurationSource
  }
}

const seq2 = [stage('M1', 'Magnus'), stage('M2', 'Lion')]
const projs2 = [proj(0), proj(12 * HOUR, 12 * HOUR, 'current_season')]

describe('buildUpcomingMains', () => {
  it('remainingFrac=1 → no elapsed subtraction; ETA == start-of-stage', () => {
    const r = buildUpcomingMains(
      seq2,
      projs2,
      1,
      new Map([['Lion', 'Lion (Display)']])
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.etaSeconds).toBe(12 * HOUR)
    expect(r[0]!.etaSource).toBe('history')
    expect(r[0]!.bossType).toBe('Lion')
    expect(r[0]!.displayName).toBe('Lion (Display)')
  })

  it('remainingFrac=0 → subtracts the full current-stage span (floored at 60s)', () => {
    const r = buildUpcomingMains(seq2, projs2, 0, new Map())
    expect(r[0]!.etaSeconds).toBe(60) // 12h - 12h = 0 → floor 60
    expect(r[0]!.displayName).toBe('') // unmatched → caller prettifies
  })

  it('non-finite remainingFrac is treated as 1 (no over-subtraction)', () => {
    const r = buildUpcomingMains(seq2, projs2, Number.NaN, new Map())
    expect(r[0]!.etaSeconds).toBe(12 * HOUR)
  })

  it('a single fallback hop flips that stage AND all later stages to estimate', () => {
    const seq3 = [stage('M1', 'A'), stage('M2', 'B'), stage('M3', 'C')]
    const projs3 = [
      proj(0),
      proj(12 * HOUR, 12 * HOUR, 'current_season'),
      proj(36 * HOUR, 24 * HOUR, 'fallback')
    ]
    const r = buildUpcomingMains(seq3, projs3, 1, new Map())
    expect(r.map((x) => x.etaSource)).toEqual(['history', 'estimate'])
    expect(r.map((x) => x.etaSeconds)).toEqual([12 * HOUR, 36 * HOUR])
  })

  it('a near-finished current stage still floors the ETA at 60s', () => {
    const projs = [proj(0), proj(300, 12 * HOUR, 'current_season')]
    const r = buildUpcomingMains(seq2, projs, 0, new Map())
    expect(r[0]!.etaSeconds).toBe(60)
  })

  it('returns empty when there is no upcoming stage', () => {
    expect(
      buildUpcomingMains([stage('M1', 'A')], [proj(0)], 1, new Map())
    ).toEqual([])
  })
})

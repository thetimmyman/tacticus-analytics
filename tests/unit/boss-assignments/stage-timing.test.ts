import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_DURATION_SECONDS,
  projectStageStartSeconds,
  tokensAt,
  type StageKillDurationMedian
} from '@/app/lib/boss-assignments/stage-timing'

const HOUR = 60 * 60
const TWELVE_H = 12 * HOUR

function median(
  stageCode: string,
  loopIndex: number,
  hours: number,
  source: 'current_season' | 'rolling_window' = 'rolling_window'
): StageKillDurationMedian {
  return {
    stageCode,
    loopIndex,
    medianSeconds: hours * HOUR,
    sampleCount: 5,
    source
  }
}

describe('projectStageStartSeconds', () => {
  it('first stage starts at 0', () => {
    const seq = [{ stageCode: 'L1', loopIndex: 0 }]
    const out = projectStageStartSeconds(seq, new Map())
    expect(out[0]?.startSeconds).toBe(0)
    expect(out[0]?.inboundDurationSeconds).toBeNull()
    expect(out[0]?.inboundDurationSource).toBeNull()
  })

  it('cumulates medians forward through the sequence', () => {
    const seq = [
      { stageCode: 'L1', loopIndex: 0 },
      { stageCode: 'L2', loopIndex: 0 },
      { stageCode: 'L3', loopIndex: 0 }
    ]
    const medians = new Map<string, StageKillDurationMedian>([
      ['L1|0', median('L1', 0, 6)],
      ['L2|0', median('L2', 0, 18)]
    ])
    const out = projectStageStartSeconds(seq, medians)
    expect(out[0]?.startSeconds).toBe(0)
    expect(out[1]?.startSeconds).toBe(6 * HOUR)
    expect(out[2]?.startSeconds).toBe(6 * HOUR + 18 * HOUR)
    expect(out[1]?.inboundDurationSource).toBe('rolling_window')
    expect(out[2]?.inboundDurationSource).toBe('rolling_window')
  })

  it('falls back to DEFAULT_STAGE_DURATION_SECONDS for stages with no median', () => {
    const seq = [
      { stageCode: 'L1', loopIndex: 0 },
      { stageCode: 'L2', loopIndex: 0 }
    ]
    const out = projectStageStartSeconds(seq, new Map())
    expect(out[1]?.startSeconds).toBe(DEFAULT_STAGE_DURATION_SECONDS)
    expect(out[1]?.inboundDurationSource).toBe('fallback')
  })

  it('handles loopIndex disambiguation (same stage_code, different loops are distinct)', () => {
    const seq = [
      { stageCode: 'L5', loopIndex: 0 },
      { stageCode: 'L5', loopIndex: 1 }
    ]
    const medians = new Map<string, StageKillDurationMedian>([
      ['L5|0', median('L5', 0, 8)],
      ['L5|1', median('L5', 1, 24)]
    ])
    const out = projectStageStartSeconds(seq, medians)
    expect(out[1]?.startSeconds).toBe(8 * HOUR)
    expect(out[1]?.inboundDurationSeconds).toBe(8 * HOUR)
  })

  it('returns empty array for empty sequence', () => {
    expect(projectStageStartSeconds([], new Map())).toEqual([])
  })
})

describe('tokensAt', () => {
  it('returns currentTokens when elapsed = 0 and nothing allocated', () => {
    expect(
      tokensAt({ currentTokens: 2, allocatedBefore: 0, elapsedSeconds: 0 })
    ).toBe(2)
  })

  it('caps at MAX_TOKENS=3 even with large regen accrual', () => {
    expect(
      tokensAt({
        currentTokens: 1,
        allocatedBefore: 0,
        elapsedSeconds: 10 * 24 * HOUR
      })
    ).toBe(3)
  })

  it('regenerates one token per 12h elapsed', () => {
    expect(
      tokensAt({
        currentTokens: 0,
        allocatedBefore: 0,
        elapsedSeconds: TWELVE_H
      })
    ).toBe(1)
    expect(
      tokensAt({
        currentTokens: 0,
        allocatedBefore: 0,
        elapsedSeconds: 2 * TWELVE_H
      })
    ).toBe(2)
    expect(
      tokensAt({
        currentTokens: 0,
        allocatedBefore: 0,
        elapsedSeconds: 3 * TWELVE_H
      })
    ).toBe(3)
  })

  it('does not regen until a full 12h has elapsed', () => {
    expect(
      tokensAt({
        currentTokens: 0,
        allocatedBefore: 0,
        elapsedSeconds: 11 * HOUR
      })
    ).toBe(0)
    expect(
      tokensAt({
        currentTokens: 0,
        allocatedBefore: 0,
        elapsedSeconds: 11 * HOUR + 59 * 60
      })
    ).toBe(0)
  })

  it('subtracts allocatedBefore from the pool', () => {
    expect(
      tokensAt({
        currentTokens: 3,
        allocatedBefore: 2,
        elapsedSeconds: 2 * TWELVE_H
      })
    ).toBe(3)
  })

  it('clamps to 0 when allocations exceed regen + bank', () => {
    expect(
      tokensAt({
        currentTokens: 1,
        allocatedBefore: 3,
        elapsedSeconds: TWELVE_H
      })
    ).toBe(0)
  })

  it('treats negative elapsedSeconds as 0 (no time-travel regen)', () => {
    expect(
      tokensAt({ currentTokens: 0, allocatedBefore: 0, elapsedSeconds: -1000 })
    ).toBe(0)
  })

  it('honors override regenSeconds and maxTokens', () => {
    expect(
      tokensAt({
        currentTokens: 0,
        allocatedBefore: 0,
        elapsedSeconds: 24 * HOUR,
        regenSeconds: 6 * HOUR,
        maxTokens: 5
      })
    ).toBe(4)
  })
})

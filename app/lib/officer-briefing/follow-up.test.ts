import { describe, it, expect } from 'vitest'
import {
  computeFollowUp,
  type FollowUpInput
} from '@/app/lib/officer-briefing/follow-up'

function base(overrides: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    expectedTeamSwap: true,
    recommendedTeamHash: 'team-best',
    originalActualAvg: 800_000,
    currentDominantTeamHash: 'team-best',
    currentActualAvg: 1_000_000,
    currentBattleCount: 4,
    ...overrides
  }
}

describe('computeFollowUp', () => {
  it('insufficient_new_evidence when no attacks recorded yet', () => {
    const r = computeFollowUp(
      base({ currentDominantTeamHash: null, currentBattleCount: 0 })
    )
    expect(r.outcome).toBe('insufficient_new_evidence')
    expect(r.newAttacksSinceAssignment).toBe(0)
  })

  it('insufficient_new_evidence when too few fresh attacks since assignment', () => {
    const r = computeFollowUp(base({ currentBattleCount: 1 }))
    expect(r.outcome).toBe('insufficient_new_evidence')
    expect(r.newAttacksSinceAssignment).toBe(1)
  })

  it('not_swapped when the dominant team is still the old one, with enough evidence', () => {
    const r = computeFollowUp(
      base({ currentDominantTeamHash: 'team-old', currentBattleCount: 4 })
    )
    expect(r.outcome).toBe('not_swapped')
    expect(r.swapped).toBe(false)
    expect(r.deltaAvg).toBeNull()
  })

  it('swapped_improved when the recommended team is adopted and avg materially rises', () => {
    const r = computeFollowUp(base())
    expect(r.outcome).toBe('swapped_improved')
    expect(r.swapped).toBe(true)
    expect(r.deltaAvg).toBe(200_000)
    expect(r.deltaPct).toBeCloseTo(0.25)
  })

  it('swapped_no_change when adopted but avg does not clear the improvement margin', () => {
    const r = computeFollowUp(base({ currentActualAvg: 810_000 })) // +1.25%, below 5%
    expect(r.outcome).toBe('swapped_no_change')
    expect(r.swapped).toBe(true)
  })

  it('swapped_no_change when adopted but avg regresses', () => {
    const r = computeFollowUp(base({ currentActualAvg: 700_000 }))
    expect(r.outcome).toBe('swapped_no_change')
    expect(r.deltaAvg).toBe(-100_000)
  })

  it('execution_improved for same-team coaching when post-assignment avg rises', () => {
    const r = computeFollowUp(
      base({
        expectedTeamSwap: false,
        recommendedTeamHash: 'team-old',
        currentDominantTeamHash: 'team-old',
        currentActualAvg: 900_000
      })
    )
    expect(r.outcome).toBe('execution_improved')
    expect(r.swapped).toBe(false)
  })

  it('execution_no_change for same-team coaching below the improvement margin', () => {
    const r = computeFollowUp(
      base({
        expectedTeamSwap: false,
        recommendedTeamHash: 'team-old',
        currentDominantTeamHash: 'team-old',
        currentActualAvg: 810_000
      })
    )
    expect(r.outcome).toBe('execution_no_change')
    expect(r.swapped).toBe(false)
  })

  it('insufficient_new_evidence when swapped but original avg is unknown', () => {
    const r = computeFollowUp(base({ originalActualAvg: null }))
    expect(r.outcome).toBe('insufficient_new_evidence')
    expect(r.swapped).toBe(true)
  })

  it('insufficient_new_evidence when swapped but current avg is unknown', () => {
    const r = computeFollowUp(base({ currentActualAvg: null }))
    expect(r.outcome).toBe('insufficient_new_evidence')
    expect(r.swapped).toBe(true)
  })

  it('newAttacksSinceAssignment never goes negative if usage looks stale/reset', () => {
    const r = computeFollowUp(base({ currentBattleCount: -1 }))
    expect(r.newAttacksSinceAssignment).toBe(0)
    expect(r.outcome).toBe('insufficient_new_evidence')
  })
})

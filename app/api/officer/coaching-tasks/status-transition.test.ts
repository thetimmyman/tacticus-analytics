import { describe, expect, it } from 'vitest'
import {
  COACHING_TASK_LIST_SELECT,
  coachingTaskExpectsTeamSwap,
  validateCoachingTaskResolution,
  validateCoachingTaskTransition
} from './_guards'

describe('validateCoachingTaskTransition', () => {
  it('allows active tasks to be acknowledged, dismissed, or resolved', () => {
    expect(validateCoachingTaskTransition('open', 'acknowledged')).toBeNull()
    expect(validateCoachingTaskTransition('open', 'dismissed')).toBeNull()
    expect(
      validateCoachingTaskTransition('acknowledged', 'resolved')
    ).toBeNull()
  })

  it('keeps closed coaching tasks terminal', () => {
    expect(validateCoachingTaskTransition('resolved', 'acknowledged')).toBe(
      'Coaching task is already closed'
    )
    expect(validateCoachingTaskTransition('dismissed', 'acknowledged')).toBe(
      'Coaching task is already closed'
    )
  })
})

describe('coaching task route guards', () => {
  it('selects guild_code for follow-up post-assignment usage', () => {
    expect(COACHING_TASK_LIST_SELECT.split(/,\s*/)).toContain('guild_code')
  })

  it('uses classification, not hash inequality, to decide team-swap follow-up mode', () => {
    expect(
      coachingTaskExpectsTeamSwap({
        classification: 'needs_support_wrong_team'
      })
    ).toBe(true)
    expect(
      coachingTaskExpectsTeamSwap({
        classification: 'needs_support_correct_team'
      })
    ).toBe(false)
  })

  it('does not allow resolved tasks to carry the dismissed resolution', () => {
    expect(validateCoachingTaskResolution('resolved', 'dismissed')).toBe(
      'resolution required when resolving'
    )
    expect(validateCoachingTaskResolution('dismissed', undefined)).toBeNull()
  })
})

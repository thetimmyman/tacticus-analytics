import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIORITY_GROUPS,
  DEFAULT_SOLVER_WEIGHTS,
  buildAssignmentConfigPayload,
  normalizeExcludedBosses,
  normalizePriorityGroups
} from '@/app/(dashboard)/guild-management/upcoming-assignments/utils/assignment-config'

describe('normalizePriorityGroups', () => {
  it('trims entries, removes blanks, and deduplicates across groups', () => {
    const groups = [
      [' M1 ', 'L5', 'M1'],
      ['L5', ' L4 ', ''],
      ['  ', 'L2', 'L3', 'L2']
    ]

    expect(normalizePriorityGroups(groups)).toEqual([
      ['M1', 'L5'],
      ['L4'],
      ['L2', 'L3']
    ])
  })

  it('drops groups that normalize to empty arrays', () => {
    expect(normalizePriorityGroups([[' '], ['\t']])).toEqual([])
  })
})

describe('normalizeExcludedBosses', () => {
  it('trims entries and removes duplicates', () => {
    const bosses = [' Boss A ', 'Boss A', '', 'Boss B', ' Boss B ']
    expect(normalizeExcludedBosses(bosses)).toEqual(['Boss A', 'Boss B'])
  })
})

describe('buildAssignmentConfigPayload', () => {
  it('applies defaults and normalizes weights and token limits', () => {
    const payload = buildAssignmentConfigPayload({
      priorityGroups: [[' ']],
      excludedBosses: [' Boss A ', ''],
      solverWeights: {
        damage: -1,
        preference: Number.NaN,
        reliability: 1.2
      },
      maxTokensPerPlayer: 2.7,
      maxTokensPerBoss: 0.8,
      minTokensPerBoss: 0.9
    })

    expect(payload.priorityGroups).toEqual(DEFAULT_PRIORITY_GROUPS)
    expect(payload.excludedBosses).toEqual(['Boss A'])
    expect(payload.solverWeights).toEqual({
      damage: 0,
      preference: DEFAULT_SOLVER_WEIGHTS.preference,
      reliability: 1.2
    })
    expect(payload.maxTokensPerPlayer).toBe(2)
    expect(payload.maxTokensPerBoss).toBe(1)
    expect(payload.minTokensPerBoss).toBe(0)
  })

  it('throws when minimum tokens exceed the maximum', () => {
    expect(() =>
      buildAssignmentConfigPayload({
        priorityGroups: [['M1']],
        excludedBosses: [],
        solverWeights: DEFAULT_SOLVER_WEIGHTS,
        maxTokensPerPlayer: 3,
        maxTokensPerBoss: 2,
        minTokensPerBoss: 5
      })
    ).toThrow('Minimum tokens per boss cannot exceed the maximum.')
  })
})

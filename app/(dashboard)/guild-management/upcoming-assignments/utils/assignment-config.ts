import {
  type BossAssignmentSolverWeights,
  DEFAULT_PRIORITY_GROUPS,
  DEFAULT_SOLVER_WEIGHTS
} from '@/app/lib/boss-assignments/config-constants'

export { DEFAULT_PRIORITY_GROUPS, DEFAULT_SOLVER_WEIGHTS }

export type AssignmentConfigPayload = {
  priorityGroups: string[][]
  excludedBosses: string[]
  solverWeights: BossAssignmentSolverWeights
  maxTokensPerPlayer: number
  maxTokensPerBoss: number
  minTokensPerBoss: number
}

export const normalizePriorityGroups = (groups: string[][]) => {
  const seen = new Set<string>()
  return groups
    .map((group) =>
      group
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => {
          if (seen.has(entry)) return false
          seen.add(entry)
          return true
        })
    )
    .filter((group) => group.length > 0)
}

export const normalizeExcludedBosses = (bosses: string[]) => {
  const seen = new Set<string>()
  bosses.forEach((boss) => {
    const trimmed = boss.trim()
    if (trimmed) {
      seen.add(trimmed)
    }
  })
  return Array.from(seen)
}

export const buildAssignmentConfigPayload = ({
  priorityGroups,
  excludedBosses,
  solverWeights,
  maxTokensPerPlayer,
  maxTokensPerBoss,
  minTokensPerBoss
}: {
  priorityGroups: string[][]
  excludedBosses: string[]
  solverWeights: BossAssignmentSolverWeights
  maxTokensPerPlayer: number
  maxTokensPerBoss: number
  minTokensPerBoss: number
}): AssignmentConfigPayload => {
  const normalizedPriorityGroups = normalizePriorityGroups(priorityGroups)
  const priorityGroupsToSave =
    normalizedPriorityGroups.length > 0
      ? normalizedPriorityGroups
      : DEFAULT_PRIORITY_GROUPS
  const excludedBossesToSave = normalizeExcludedBosses(excludedBosses)

  const normalizeWeight = (value: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(0, value) : fallback

  const normalizedWeights = {
    damage: normalizeWeight(
      solverWeights.damage,
      DEFAULT_SOLVER_WEIGHTS.damage
    ),
    preference: normalizeWeight(
      solverWeights.preference,
      DEFAULT_SOLVER_WEIGHTS.preference
    ),
    reliability: normalizeWeight(
      solverWeights.reliability,
      DEFAULT_SOLVER_WEIGHTS.reliability
    )
  }

  const resolvedMaxTokensPerPlayer = Math.max(1, Math.trunc(maxTokensPerPlayer))
  const resolvedMaxTokensPerBoss = Math.max(1, Math.trunc(maxTokensPerBoss))
  const resolvedMinTokensPerBoss = Math.max(0, Math.trunc(minTokensPerBoss))

  if (resolvedMinTokensPerBoss > resolvedMaxTokensPerBoss) {
    throw new Error('Minimum tokens per boss cannot exceed the maximum.')
  }

  return {
    priorityGroups: priorityGroupsToSave,
    excludedBosses: excludedBossesToSave,
    solverWeights: normalizedWeights,
    maxTokensPerPlayer: resolvedMaxTokensPerPlayer,
    maxTokensPerBoss: resolvedMaxTokensPerBoss,
    minTokensPerBoss: resolvedMinTokensPerBoss
  }
}

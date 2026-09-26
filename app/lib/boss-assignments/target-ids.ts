export interface StageAssignmentLike {
  stageCode: string
  loopIndex: number
  assignments: Array<{
    playerId: string
    bossId: string
    tokens: number
  }>
}

const SOLVER_TARGET_ID_PATTERN = /^([ML][1-5])_(main|prime1|prime2)$/i

export function normalizeBossTargetId(bossId: string): string {
  const trimmed = bossId.trim()
  const match = trimmed.match(SOLVER_TARGET_ID_PATTERN)
  if (!match) return trimmed

  const stageCode = match[1]?.toUpperCase() ?? trimmed
  const targetType = match[2]?.toLowerCase()

  if (targetType === 'main') return stageCode
  if (targetType === 'prime1') return `${stageCode}_Sub1`
  if (targetType === 'prime2') return `${stageCode}_Sub2`
  return trimmed
}

export function normalizeTokenAllocationRecord(
  allocations: Record<string, number> | null | undefined
): Record<string, number> {
  const normalized = new Map<string, number>()
  if (!allocations) return Object.fromEntries(normalized)

  Object.entries(allocations).forEach(([rawBossId, rawTokens]) => {
    if (
      typeof rawTokens !== 'number' ||
      !Number.isFinite(rawTokens) ||
      rawTokens <= 0
    )
      return

    const targetId = normalizeBossTargetId(rawBossId)
    normalized.set(
      targetId,
      (normalized.get(targetId) ?? 0) + Math.trunc(rawTokens)
    )
  })

  return Object.fromEntries(normalized)
}

export function normalizePlayerTokenAllocations(
  allocationsByPlayer: Record<string, Record<string, number>> | null | undefined
): Record<string, Record<string, number>> {
  const normalized = new Map<string, Record<string, number>>()
  if (!allocationsByPlayer) return Object.fromEntries(normalized)

  Object.entries(allocationsByPlayer).forEach(([playerKey, allocations]) => {
    normalized.set(playerKey, normalizeTokenAllocationRecord(allocations))
  })

  return Object.fromEntries(normalized)
}

export function normalizeAssignmentReasons(
  reasonsByPlayer: Record<string, Record<string, string>> | null | undefined
): Record<string, Record<string, string>> {
  const normalized = new Map<string, Record<string, string>>()
  if (!reasonsByPlayer) return Object.fromEntries(normalized)

  Object.entries(reasonsByPlayer).forEach(([playerKey, reasons]) => {
    const nextReasons = new Map<string, string>()

    Object.entries(reasons ?? {}).forEach(([rawBossId, reason]) => {
      if (typeof reason !== 'string' || reason.trim().length === 0) return
      nextReasons.set(normalizeBossTargetId(rawBossId), reason)
    })

    normalized.set(playerKey, Object.fromEntries(nextReasons))
  })

  return Object.fromEntries(normalized)
}

export function buildStageAssignmentTokenMap(
  stageAssignments: StageAssignmentLike[] | null | undefined,
  stageCode: string | null | undefined,
  loopIndex: number | null | undefined
): Map<string, number> {
  const tokenMap = new Map<string, number>()
  if (
    !stageAssignments ||
    !stageCode ||
    typeof loopIndex !== 'number' ||
    !Number.isFinite(loopIndex)
  ) {
    return tokenMap
  }

  stageAssignments
    .filter(
      (stage) => stage.stageCode === stageCode && stage.loopIndex === loopIndex
    )
    .forEach((stage) => {
      stage.assignments.forEach((assignment) => {
        if (
          typeof assignment.tokens !== 'number' ||
          !Number.isFinite(assignment.tokens) ||
          assignment.tokens <= 0
        ) {
          return
        }

        const targetId = normalizeBossTargetId(assignment.bossId)
        const key = `${assignment.playerId}:${targetId}`
        tokenMap.set(
          key,
          (tokenMap.get(key) ?? 0) + Math.trunc(assignment.tokens)
        )
      })
    })

  return tokenMap
}

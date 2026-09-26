import type { Logger } from './logger.ts'

// The `<name> (<guildCode>_<NN>)` suffix is persisted and ~30 RPCs join on it, so this must match
// handleDuplicateDisplayNames in app/lib/sync/transformers.ts (parity test pins it). Groups on the
// trimmed name; duplicates sort by userId, numbered 1-based, 2-digit.
export function disambiguateDuplicateDisplayNames<
  T extends { userId: string; displayName: string }
>(
  lokiMembers: T[],
  guildCode: string,
  logger: Pick<Logger, 'warn'>
): (T & { originalDisplayName?: string; hasDuplicateName?: boolean })[] {
  const nameGroups = new Map<string, T[]>()

  for (const member of lokiMembers) {
    const rawDisplayName =
      typeof member.displayName === 'string' ? member.displayName.trim() : ''
    const normalizedDisplayName =
      rawDisplayName.length > 0
        ? rawDisplayName
        : typeof member.userId === 'string' && member.userId.trim().length > 0
          ? member.userId
          : `UNKNOWN_${guildCode}`

    const members = nameGroups.get(normalizedDisplayName) ?? []
    members.push(member)
    nameGroups.set(normalizedDisplayName, members)
  }

  const processed: (T & {
    originalDisplayName?: string
    hasDuplicateName?: boolean
  })[] = []

  for (const [displayName, members] of nameGroups) {
    if (members.length === 1) {
      const [member] = members
      if (member) {
        processed.push(member)
      }
      continue
    }

    logger.warn(
      `Found ${members.length} players with duplicate name "${displayName}"`
    )
    members.sort((a, b) => {
      const aId = typeof a.userId === 'string' ? a.userId : ''
      const bId = typeof b.userId === 'string' ? b.userId : ''
      return aId.localeCompare(bId)
    })

    for (let i = 0; i < members.length; i++) {
      const baseMember = members[i]
      if (!baseMember) continue
      const suffix = `(${guildCode}_${String(i + 1).padStart(2, '0')})`
      processed.push({
        ...baseMember,
        displayName: `${displayName} ${suffix}`,
        originalDisplayName: displayName,
        hasDuplicateName: true
      })
    }
  }

  return processed
}

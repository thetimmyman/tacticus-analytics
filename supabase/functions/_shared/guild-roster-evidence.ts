export interface GuildRosterEvidence {
  success: boolean
  memberIds: string[]
  error?: string
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Membership authority belongs to the requested guild and a complete roster. */
export function extractGuildRosterEvidence(
  payload: unknown,
  expectedGuildId: string
): GuildRosterEvidence {
  const envelope = record(payload)
  const guild =
    envelope && ('guild' in envelope ? record(envelope.guild) : envelope)
  if (!expectedGuildId || guild?.guildId !== expectedGuildId)
    return {
      success: false,
      memberIds: [],
      error: 'Guild identity unavailable or mismatched'
    }
  if (!Array.isArray(guild.members) || guild.members.length === 0)
    return { success: false, memberIds: [], error: 'Guild roster unavailable' }
  const ids = new Set<string>()
  for (const value of guild.members) {
    const id = record(value)?.userId
    if (typeof id !== 'string' || !id || id.trim() !== id)
      return { success: false, memberIds: [], error: 'Guild roster invalid' }
    ids.add(id)
  }
  return { success: true, memberIds: [...ids] }
}

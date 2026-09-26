/**
 * Maps a raw Tacticus/LOKI guild role to the app's 3-level role (co-leaders are 'leader').
 * The edge copy in sync-modules/loki-api.ts cannot import this and must mirror it.
 */
export function normalizeTacticusGuildRole(
  raw: string | null | undefined
): 'leader' | 'officer' | 'member' {
  const r = (raw ?? '').toUpperCase().trim()
  if (
    r === 'LEADER' ||
    r === 'GUILD_LEADER' ||
    r === 'CO_LEADER' ||
    r === 'COLEADER'
  ) {
    return 'leader'
  }
  if (r === 'OFFICER' || r === 'GUILD_OFFICER') {
    return 'officer'
  }
  return 'member'
}

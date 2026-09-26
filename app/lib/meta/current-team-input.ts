export type CurrentTeamInput = {
  boss_type: string
  current_team?: string | null
  current_team_hash?: string | null
  encounter_index?: number | null
  rarity_set?: string | null
  season?: string | null
}

function normalizeCurrentTeam(
  bossType: string,
  value: unknown
): CurrentTeamInput | null {
  if (typeof value === 'string') {
    return { boss_type: bossType, current_team: value }
  }
  if (!value || typeof value !== 'object') return null

  const entry = value as Record<string, unknown>
  return {
    boss_type: bossType,
    current_team:
      typeof entry.current_team === 'string' ? entry.current_team : null,
    current_team_hash:
      typeof entry.current_team_hash === 'string'
        ? entry.current_team_hash
        : null,
    encounter_index:
      typeof entry.encounter_index === 'number' ? entry.encounter_index : null,
    rarity_set: typeof entry.rarity_set === 'string' ? entry.rarity_set : null,
    season: typeof entry.season === 'string' ? entry.season : null
  }
}

export function normalizeCurrentTeams(
  value: unknown
): Map<string, CurrentTeamInput> {
  const lookup = new Map<string, CurrentTeamInput>()
  if (!value) return lookup

  if (Array.isArray(value)) {
    for (const valueEntry of value) {
      if (!valueEntry || typeof valueEntry !== 'object') continue
      const entry = valueEntry as Record<string, unknown>
      const bossType =
        typeof entry.boss_type === 'string' ? entry.boss_type : null
      if (!bossType) continue
      const normalized = normalizeCurrentTeam(bossType, entry)
      if (normalized) lookup.set(bossType, normalized)
    }
    return lookup
  }

  if (typeof value === 'object') {
    for (const [bossType, entry] of Object.entries(
      value as Record<string, unknown>
    )) {
      const normalized = normalizeCurrentTeam(bossType, entry)
      if (normalized) lookup.set(bossType, normalized)
    }
  }

  return lookup
}

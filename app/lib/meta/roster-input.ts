export const MAX_ROSTER_SIZE = 300

export type RosterHeroAbilityInput = {
  id?: string | null
  level?: number | null
}

export type RosterHeroInput = {
  id?: string | null
  name?: string | null
  engineId?: string | null
  power?: number | null
  xpLevel?: number | null
  rank?: number | null
  progressionIndex?: number | null
  stars?: number | null
  abilities?: RosterHeroAbilityInput[] | null
  category?: string | null
}

export type RosterInputEntry = string | RosterHeroInput

export type ParsedRoster = {
  roster: RosterInputEntry[] | null
  error?: string
}

const normalizeAbility = (value: unknown): RosterHeroAbilityInput | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : null
  const level =
    typeof record.level === 'number' && Number.isFinite(record.level)
      ? record.level
      : null
  if (!id && level === null) return null
  return { id, level }
}

const normalizeRosterObject = (
  value: Record<string, unknown>
): RosterHeroInput | null => {
  const id = typeof value.id === 'string' ? value.id : null
  const name = typeof value.name === 'string' ? value.name : null
  const engineId = typeof value.engineId === 'string' ? value.engineId : null
  const power =
    typeof value.power === 'number' && Number.isFinite(value.power)
      ? value.power
      : null
  const xpLevel =
    typeof value.xpLevel === 'number' && Number.isFinite(value.xpLevel)
      ? value.xpLevel
      : null
  const rank =
    typeof value.rank === 'number' && Number.isFinite(value.rank)
      ? value.rank
      : null
  const progressionIndex =
    typeof value.progressionIndex === 'number' &&
    Number.isFinite(value.progressionIndex)
      ? value.progressionIndex
      : null
  const stars =
    typeof value.stars === 'number' && Number.isFinite(value.stars)
      ? value.stars
      : null
  const category = typeof value.category === 'string' ? value.category : null

  const abilities = Array.isArray(value.abilities)
    ? value.abilities
        .map((entry) => normalizeAbility(entry))
        .filter((entry): entry is RosterHeroAbilityInput => Boolean(entry))
    : null

  const hasIdentity = Boolean(id || name || engineId)
  if (!hasIdentity) return null

  return {
    id,
    name,
    engineId,
    power,
    xpLevel,
    rank,
    progressionIndex,
    stars,
    abilities,
    category
  }
}

export function parseRosterPayload(value: unknown): ParsedRoster {
  if (value == null) return { roster: null }
  if (!Array.isArray(value)) {
    return {
      roster: null,
      error: 'roster must be an array of hero names or objects'
    }
  }
  if (value.length > MAX_ROSTER_SIZE) {
    return {
      roster: null,
      error: `roster must contain ${MAX_ROSTER_SIZE} entries or fewer`
    }
  }

  const roster: RosterInputEntry[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim()
      if (trimmed) roster.push(trimmed)
      continue
    }
    if (entry && typeof entry === 'object') {
      const normalized = normalizeRosterObject(entry as Record<string, unknown>)
      if (normalized) roster.push(normalized)
    }
  }

  return { roster }
}

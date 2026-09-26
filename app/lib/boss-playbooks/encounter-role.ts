export type EncounterRoleColumn = 'boss' | 'prime' | 'sideboss'
export type EncounterSide = 'main' | 'side'

const COLUMN_VALUES: readonly EncounterRoleColumn[] = [
  'boss',
  'prime',
  'sideboss'
]

export function normalizeEncounterRole(
  value: unknown
): EncounterRoleColumn | null {
  if (typeof value !== 'string') return null
  const s = value.trim().toLowerCase()
  return (COLUMN_VALUES as readonly string[]).includes(s)
    ? (s as EncounterRoleColumn)
    : null
}

/** Null when the column is absent, so callers fall back to tags/title. */
export function encounterRoleToSide(
  role: EncounterRoleColumn | null | undefined
): EncounterSide | null {
  if (role === 'boss') return 'main'
  if (role === 'prime' || role === 'sideboss') return 'side'
  return null
}

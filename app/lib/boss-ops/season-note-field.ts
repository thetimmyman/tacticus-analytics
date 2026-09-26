/** Absent = legacy fallback; `null` = cleared; keep them distinct or a cleared note resurrects. */

/** Malformed values count as absent, not as cleared. */
export function parseSeasonNoteField(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  return typeof raw === 'string' ? raw : undefined
}

export function resolveNoteOverride(
  override: string | null | undefined,
  legacy: string | null
): string | null {
  if (typeof override === 'string') return override
  if (override === null) return null
  return legacy
}

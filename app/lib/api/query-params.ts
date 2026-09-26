/** Callers depend on the exact edge-case semantics; check every caller before changing them. */

/** Number()-based: finite and > 0 → floored int, else fallback. */
export function parsePositiveInt(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }
  return fallback
}

/** parseInt(10)-based: finite → int (negatives allowed), else fallback. */
export function parseIntParam(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Number()-based: any finite number (float ok), else fallback. */
export function parseNumberParam(
  value: string | null,
  fallback: number
): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Number()-based: any finite number, else null. */
export function parseOptionalNumberParam(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Makes user-typed % _ \ match literally in PostgREST `ilike`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

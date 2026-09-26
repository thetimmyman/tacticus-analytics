/** Server-safe date helpers; gate locale-dependent rendering with `useHasMounted`. */

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** `YYYY-MM-DDTHH-MM-SS` (no ms, no `Z`); '' for invalid input. */
export function formatISOForFilename(
  value: Date | string | number = new Date()
): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function formatISODateOnly(
  value: Date | string | number = new Date()
): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toISOString().slice(0, 10)
}

/** Now-dependent: gate with useHasMounted. Separate from the coarser members-utils version. */
export function formatRelativeTime(iso: string | null, now: number): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'never'
  const diffSec = Math.max(0, Math.round((now - t) / 1000))
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

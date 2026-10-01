/** Server-safe date helpers; gate locale-dependent rendering with `useHasMounted`. */

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

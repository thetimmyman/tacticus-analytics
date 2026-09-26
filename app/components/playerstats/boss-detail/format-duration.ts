// Not `@tacticus/app-core/formatters`' formatDuration, which floors sub-minute
// values to '0m' (this returns '45s') and would type-check silently.

// Seconds → "45s" / "3m" / "2h 5m" (rounded per tier, no days).
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

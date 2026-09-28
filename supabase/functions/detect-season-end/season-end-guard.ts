// Whether a season's window (season_calendar.starts_at/ends_at) has closed.
// No Deno imports, so it runs under vitest like calculate-votlw's
// season-guard.ts. Never derive "ended" from checking for the NEXT season's
// battle rows: a cluster's own current season is by definition its max, so
// that check can never fire — the bug this replaces.

// Same grace calculate-votlw's own season-guard applies before scoring a
// season: battles can keep syncing in for a while after the window closes,
// and the summary is claimed exactly once (season_summary_tracking.sent_at
// blocks regeneration), so firing right at ends_at risks permanently
// under-counting a season whose last battles hadn't landed yet.
export const SEASON_SUMMARY_GRACE_MS = 24 * 60 * 60 * 1000

export function hasSeasonEnded(
  nowMs: number,
  endsAtIso: string | null | undefined,
  graceMs: number = SEASON_SUMMARY_GRACE_MS
): boolean {
  if (!endsAtIso) return false // no calendar row yet: don't guess "ended"
  const endsAtMs = Date.parse(endsAtIso)
  if (!Number.isFinite(endsAtMs)) return false
  return nowMs >= endsAtMs + graceMs
}

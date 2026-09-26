// After a deploy, old bundles call Server Action IDs the new build lacks; the fix is a reload.

const RELOADED_AT_KEY = 'stale-deploy-reloaded-at'
// If a reload didn't clear the error, fall through instead of reload-looping.
const RELOAD_COOLDOWN_MS = 60_000

export function isStaleServerActionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    message.includes('Failed to find Server Action') ||
    /Server Action "[^"]*" was not found/.test(message)
  )
}

/** Returns true when a reload started (suppress error UI), false in cooldown. */
export function reloadForStaleDeploy(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_AT_KEY) ?? 0)
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false
    window.sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()))
  } catch {
    // No sessionStorage: still reload; the load resets JS state, so no tight loop.
  }
  window.location.reload()
  return true
}

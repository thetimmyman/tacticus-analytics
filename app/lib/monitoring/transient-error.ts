// Transient infrastructure failures that resolve on retry. The beforeSend
// hooks already drop these when they surface directly; this lets the same
// events be dropped when a fail-closed boundary wraps them as a `cause`.
const TRANSIENT_MESSAGE_PATTERNS: string[] = [
  'fetch failed',
  'failed to pipe response',
  'ECONNRESET',
  'ETIMEDOUT',
  'socket hang up'
]

function isTransientMessage(message: string): boolean {
  return (
    TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern)) ||
    message.includes('schema cache') ||
    (message.includes('does not exist') && message.includes('function'))
  )
}

/** True when any error in `error`'s cause chain is a known transient failure. */
export function hasTransientCause(error: unknown): boolean {
  let cause = error instanceof Error ? error.cause : undefined
  const seen = new Set<unknown>()
  while (cause !== undefined && cause !== null && !seen.has(cause)) {
    seen.add(cause)
    if (cause instanceof Error && isTransientMessage(cause.message)) {
      return true
    }
    cause = cause instanceof Error ? cause.cause : undefined
  }
  return false
}

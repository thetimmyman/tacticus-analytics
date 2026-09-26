/**
 * Module-scoped (shared across guilds in a warm isolate), so one guild's revoked key must not open it
 * for everyone: only 5xx and network errors count. Status is parsed from the Error message.
 */
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404])
// Throttled-key 4xx are retried but do not count: one key's throttling is not
// upstream sickness (parity with app/lib/sync/worker-types.ts).
const TRANSIENT_NONCOUNTING_HTTP_STATUSES = new Set([408, 425, 429])

export class CircuitBreaker {
  private failureCount = 0
  private lastFailureTime: number | null = null
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'

  constructor(
    private failureThreshold = 2,
    private recoveryTimeMs = 30000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - (this.lastFailureTime || 0) > this.recoveryTimeMs) {
        // Reset on HALF_OPEN, or a non-counting probe error leaves the count at the
        // threshold and one 5xx from another guild re-opens the breaker.
        this.state = 'HALF_OPEN'
        this.failureCount = 0
      } else {
        throw new Error('Circuit breaker is OPEN')
      }
    }

    try {
      const result = await operation()
      // Consecutive-failure semantics: success resets the counter.
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED'
      }
      this.failureCount = 0
      return result
    } catch (error) {
      if (CircuitBreaker.shouldCount(error)) {
        this.failureCount++
        this.lastFailureTime = Date.now()
        if (this.failureCount >= this.failureThreshold) {
          this.state = 'OPEN'
        }
      }
      // A non-counting error proves neither health nor sickness; stay HALF_OPEN.
      throw error
    }
  }

  /** False for permanent/per-key 4xx and our own local timeouts. */
  static shouldCount(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    // Our own timeout often means local event-loop starvation, not upstream failure (as in the app twin).
    if (message.startsWith('Request timed out after')) {
      return false
    }
    const status = CircuitBreaker.parseHttpStatus(message)
    if (
      status !== null &&
      (PERMANENT_HTTP_STATUSES.has(status) ||
        TRANSIENT_NONCOUNTING_HTTP_STATUSES.has(status))
    ) {
      return false
    }
    return true
  }

  private static parseHttpStatus(message: string): number | null {
    const match = message.match(/API returned (\d{3})\b/)
    if (!match) return null
    return Number(match[1])
  }
}

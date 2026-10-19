// Runtime-agnostic switch state, shared by the edge runtime and the Next app.
// Each runtime supplies its own flag reader; only the decision lives here.
export const OUTBOUND_KILL_SWITCH_KEY = 'upstream_outbound'

export const OUTBOUND_KILL_SWITCH_CACHE_MS = 30_000

/**
 * Halted only when a stage is recorded and it is not 'public'. No row, or a
 * flag that cannot be read, means OPEN: the switch stops traffic by operator
 * decision, so a missing or broken switch must never stop the product.
 */
export function isOutboundHaltedStage(stage: unknown): boolean {
  return typeof stage === 'string' && stage.length > 0 && stage !== 'public'
}

export interface OutboundKillSwitch {
  halted(now?: number): Promise<boolean>
  reset(): void
}

/**
 * One switch instance per runtime. The reader is injected because the edge
 * runtime and the app reach the same flag through different database clients.
 * Cached so the dispatch path does not read the flag per request.
 */
export function createOutboundKillSwitch(
  read: () => Promise<unknown>,
  warn: (message: string, error: unknown) => void,
  cacheMs: number = OUTBOUND_KILL_SWITCH_CACHE_MS
): OutboundKillSwitch {
  let cached: { halted: boolean; at: number } | null = null
  return {
    reset(): void {
      cached = null
    },
    async halted(now: number = Date.now()): Promise<boolean> {
      if (cached && now - cached.at < cacheMs) return cached.halted
      try {
        cached = { halted: isOutboundHaltedStage(await read()), at: now }
      } catch (error) {
        warn('outbound kill switch unreadable, assuming open:', error)
        cached = { halted: false, at: now }
      }
      return cached.halted
    }
  }
}

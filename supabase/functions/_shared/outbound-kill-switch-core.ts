// Runtime-agnostic switch state, shared by the edge runtime and the Next app.
// Each runtime supplies its own flag reader; only the decision lives here.
export const OUTBOUND_KILL_SWITCH_KEY = 'upstream_outbound'

export const OUTBOUND_KILL_SWITCH_CACHE_MS = 30_000

/** A read slower than this counts as unreadable; dispatch must not wait longer. */
export const OUTBOUND_KILL_SWITCH_READ_TIMEOUT_MS = 2_000

/**
 * Halted only when a stage is recorded and it is not 'public'. No row, or a
 * flag that cannot be read, means OPEN: the switch stops traffic by operator
 * decision, so a missing or broken switch must never stop the product.
 */
export function isOutboundHaltedStage(stage: unknown): boolean {
  return typeof stage === 'string' && stage.length > 0 && stage !== 'public'
}

/** Resolves the recorded stage; must stop work when the signal aborts. */
export type OutboundKillSwitchReader = (signal: AbortSignal) => Promise<unknown>

export interface OutboundKillSwitchOptions {
  cacheMs?: number
  timeoutMs?: number
}

export interface OutboundKillSwitch {
  halted(now?: number): Promise<boolean>
  reset(): void
}

/**
 * One switch instance per runtime, reading through an injected reader. Cached,
 * one read in flight, bounded by a timeout. Opens when nothing was ever read;
 * keeps a halt already read. See docs/outbound-kill-switch.md.
 */
export function createOutboundKillSwitch(
  read: OutboundKillSwitchReader,
  warn: (message: string, error: unknown) => void,
  options: OutboundKillSwitchOptions = {}
): OutboundKillSwitch {
  const cacheMs = options.cacheMs ?? OUTBOUND_KILL_SWITCH_CACHE_MS
  const timeoutMs = options.timeoutMs ?? OUTBOUND_KILL_SWITCH_READ_TIMEOUT_MS
  let cached: { halted: boolean; at: number } | null = null
  let lastRead: boolean | null = null
  let inflight: Promise<boolean> | null = null
  let generation = 0

  async function readBounded(): Promise<unknown> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`read exceeded ${timeoutMs}ms`))
      }, timeoutMs)
    })
    try {
      return await Promise.race([read(controller.signal), expired])
    } finally {
      clearTimeout(timer)
    }
  }

  async function refresh(now: number, startedIn: number): Promise<boolean> {
    let halted: boolean
    try {
      const stage = await readBounded()
      if (typeof stage !== 'string') {
        warn('outbound kill switch row missing, assuming open:', stage)
      }
      halted = isOutboundHaltedStage(stage)
      if (startedIn === generation) lastRead = halted
    } catch (error) {
      halted = lastRead ?? false
      warn(
        halted
          ? 'outbound kill switch unreadable, keeping last known halt:'
          : 'outbound kill switch unreadable, assuming open:',
        error
      )
    }
    if (startedIn === generation) cached = { halted, at: now }
    return halted
  }

  return {
    reset(): void {
      generation += 1
      cached = null
      lastRead = null
      inflight = null
    },
    halted(now: number = Date.now()): Promise<boolean> {
      if (cached && now - cached.at < cacheMs) {
        return Promise.resolve(cached.halted)
      }
      if (!inflight) {
        const started = refresh(now, generation)
        const shared: Promise<boolean> = started.finally(() => {
          if (inflight === shared) inflight = null
        })
        inflight = shared
      }
      return inflight
    }
  }
}

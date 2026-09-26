// Standalone Deno copy of the sync timeout config (no app imports).

export interface SyncTimeoutConfig {
  SUPABASE_EDGE_FUNCTION: number
  EDGE_FUNCTION_BUFFER: number
  WORKER_PROCESS: number
  GUILD_SYNC_BATCH: number
  API_REQUEST: number
  INDIVIDUAL_CALL: number
}

export interface TimeoutEnvironment {
  isDevelopment: boolean
  isTest: boolean
  isProduction: boolean
}

export function getEnvironment(): TimeoutEnvironment {
  const isDevelopment = false // edge functions always run production-like
  const isTest = false
  const isProduction = true

  return { isDevelopment, isTest, isProduction }
}

export const SYNC_TIMEOUTS: SyncTimeoutConfig = {
  SUPABASE_EDGE_FUNCTION: 110000, // Supabase hard limit
  EDGE_FUNCTION_BUFFER: 95000, // safe execution window
  WORKER_PROCESS: 80000,
  GUILD_SYNC_BATCH: 25000,
  API_REQUEST: 15000,
  INDIVIDUAL_CALL: 10000
}

// Longer limits for debugging; unused while getEnvironment() is hard-coded.
export const SYNC_TIMEOUTS_DEV: SyncTimeoutConfig = {
  SUPABASE_EDGE_FUNCTION: 110000,
  EDGE_FUNCTION_BUFFER: 95000,
  WORKER_PROCESS: 300000,
  GUILD_SYNC_BATCH: 120000,
  API_REQUEST: 30000,
  INDIVIDUAL_CALL: 20000
}

export function getSyncTimeouts(): SyncTimeoutConfig {
  const env = getEnvironment()
  return env.isDevelopment ? SYNC_TIMEOUTS_DEV : SYNC_TIMEOUTS
}

export function createTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

// Exponential backoff capped at 10s, plus up to 1s jitter.
export function calculateRetryDelay(attempt: number): number {
  const baseDelay = 1000
  const maxDelay = 10000
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
  return delay + Math.random() * 1000
}

export class TimeoutContext {
  private startTime: number
  private maxDuration: number
  private terminationBuffer: number

  constructor(
    maxDurationMs: number,
    public readonly contextName: string = 'operation',
    terminationBufferMs: number = 5000
  ) {
    this.startTime = Date.now()
    this.maxDuration = maxDurationMs
    this.terminationBuffer = terminationBufferMs
  }

  getElapsed(): number {
    return Date.now() - this.startTime
  }

  getRemaining(): number {
    return Math.max(0, this.maxDuration - this.getElapsed())
  }

  hasTime(requiredMs: number): boolean {
    return this.getRemaining() >= requiredMs
  }

  shouldTerminateEarly(): boolean {
    return this.getRemaining() <= this.terminationBuffer
  }

  createChildContext(
    childTimeoutMs: number,
    childName: string
  ): TimeoutContext {
    const remainingTime = this.getRemaining()
    const actualTimeout = Math.min(childTimeoutMs, remainingTime)
    return new TimeoutContext(actualTimeout, childName)
  }
}

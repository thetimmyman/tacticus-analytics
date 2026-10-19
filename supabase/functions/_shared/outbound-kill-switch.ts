import { createServiceClient } from './supabase-client.ts'
import { logger } from './logger.ts'

// An operator sets release_stage away from 'public' to stop provider traffic.
export const OUTBOUND_KILL_SWITCH_KEY = 'upstream_outbound'

// Polled per dispatch, not per request: 30s bounds staleness of the switch.
const CACHE_MS = 30_000

/**
 * Halted only when a stage is recorded and it is not 'public'. No row, or a
 * flag that cannot be read, means OPEN. The switch exists to stop traffic by
 * decision, so a missing or broken switch must never stop the product.
 */
export function isOutboundHaltedStage(stage: unknown): boolean {
  return typeof stage === 'string' && stage.length > 0 && stage !== 'public'
}

async function readStage(): Promise<unknown> {
  const { data, error } = await createServiceClient()
    .from('feature_releases')
    .select('release_stage')
    .eq('feature_key', OUTBOUND_KILL_SWITCH_KEY)
    .maybeSingle()
  if (error) throw error
  return (data as { release_stage?: unknown } | null)?.release_stage
}

let cached: { halted: boolean; at: number } | null = null

export function resetOutboundKillSwitchCache(): void {
  cached = null
}

/**
 * True when an operator has halted outbound provider dispatch. Callers must
 * refuse locally before sending. Read failures resolve open and are logged,
 * because a switch that silently cannot engage is worse than a loud one.
 */
export async function outboundHalted(
  now: number = Date.now(),
  read: () => Promise<unknown> = readStage
): Promise<boolean> {
  if (cached && now - cached.at < CACHE_MS) return cached.halted
  try {
    cached = { halted: isOutboundHaltedStage(await read()), at: now }
  } catch (error) {
    logger.warn('outbound kill switch unreadable, assuming open:', error)
    cached = { halted: false, at: now }
  }
  return cached.halted
}

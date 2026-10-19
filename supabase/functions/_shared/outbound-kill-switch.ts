import { createServiceClient } from './supabase-client.ts'
import { logger } from './logger.ts'
import {
  createOutboundKillSwitch,
  OUTBOUND_KILL_SWITCH_KEY
} from './outbound-kill-switch-core.ts'

export {
  isOutboundHaltedStage,
  OUTBOUND_KILL_SWITCH_KEY
} from './outbound-kill-switch-core.ts'

async function readStageFromDb(): Promise<unknown> {
  const { data, error } = await createServiceClient()
    .from('feature_releases')
    .select('release_stage')
    .eq('feature_key', OUTBOUND_KILL_SWITCH_KEY)
    .maybeSingle()
  if (error) throw error
  return (data as { release_stage?: unknown } | null)?.release_stage
}

// Indirection so the dispatch test can supply a stage without a database.
let readStage: () => Promise<unknown> = readStageFromDb

const switchState = createOutboundKillSwitch(
  () => readStage(),
  (message, error) => logger.warn(message, error)
)

/** True when an operator has halted outbound provider dispatch. */
export function outboundHalted(now?: number): Promise<boolean> {
  return switchState.halted(now)
}

export function resetOutboundKillSwitchCache(): void {
  switchState.reset()
}

/** Test seam: replace the database reader, or pass null to restore it. */
export function useOutboundKillSwitchReader(
  read: (() => Promise<unknown>) | null
): void {
  readStage = read ?? readStageFromDb
  switchState.reset()
}

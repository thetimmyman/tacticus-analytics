import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { serviceDb } from '@/app/lib/db'
import { logger } from '@/app/lib/logging/logger'
import {
  createOutboundKillSwitch,
  OUTBOUND_KILL_SWITCH_KEY,
  type OutboundKillSwitchReader
} from '@/supabase/functions/_shared/outbound-kill-switch-core'

export {
  isOutboundHaltedStage,
  OUTBOUND_KILL_SWITCH_KEY
} from '@/supabase/functions/_shared/outbound-kill-switch-core'

// The same `feature_releases` row the edge runtime reads; the shared core
// bounds, coalesces and fails open (see docs/outbound-kill-switch.md).
// A desktop install talks to its own loopback database, which no operator can
// reach, so there is nothing central to read there.
const readStageFromDb: OutboundKillSwitchReader = async (signal) => {
  if (getRuntimeProfile() === 'desktop') return 'public'
  const { data, error } = await serviceDb(signal)
    .from('feature_releases')
    .select('release_stage')
    .eq('feature_key', OUTBOUND_KILL_SWITCH_KEY)
    .limit(1)
  if (error) throw error
  return (data as { release_stage?: unknown }[] | null)?.[0]?.release_stage
}

// Indirection so the dispatch test can supply a stage without a database.
let readStage: OutboundKillSwitchReader = readStageFromDb

const switchState = createOutboundKillSwitch(
  (signal) => readStage(signal),
  (message, error) => logger.warn({ err: error }, message)
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
  read: OutboundKillSwitchReader | null
): void {
  readStage = read ?? readStageFromDb
  switchState.reset()
}

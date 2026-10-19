import { serviceDb } from '@/app/lib/db'
import { logger } from '@/app/lib/logging/logger'
import {
  createOutboundKillSwitch,
  OUTBOUND_KILL_SWITCH_KEY
} from '@/supabase/functions/_shared/outbound-kill-switch-core'

export {
  isOutboundHaltedStage,
  OUTBOUND_KILL_SWITCH_KEY
} from '@/supabase/functions/_shared/outbound-kill-switch-core'

async function readStageFromDb(): Promise<unknown> {
  const { data, error } = await serviceDb()
    .from('feature_releases')
    .select('release_stage')
    .eq('feature_key', OUTBOUND_KILL_SWITCH_KEY)
    .limit(1)
  if (error) throw error
  return (data as { release_stage?: unknown }[] | null)?.[0]?.release_stage
}

// Indirection so the dispatch test can supply a stage without a database.
let readStage: () => Promise<unknown> = readStageFromDb

const switchState = createOutboundKillSwitch(
  () => readStage(),
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
  read: (() => Promise<unknown>) | null
): void {
  readStage = read ?? readStageFromDb
  switchState.reset()
}

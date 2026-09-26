import { runUserTokenAlertScan } from '@/app/lib/token-alerts/scan'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'

const userTokenAlertScanHandler: JobHandler = async (_payload, ctx) => {
  // Stop sending before the run could outlive the reaper and be claimed twice.
  const summary = await runUserTokenAlertScan({
    softDeadlineAt: ctx?.softDeadlineAt
  })
  return { ...summary }
}

export function registerUserTokenAlertScanHandler(): void {
  registerJobHandler('user-token-alert-scan', userTokenAlertScanHandler)
}

export const __internal = {
  userTokenAlertScanHandler
}

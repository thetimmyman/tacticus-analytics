// Imported for side effects; a handler stays dormant until work_queue rows exist for its job_type.

import { registerSeasonTransitionMonitorHandler } from './season-transition-monitor'
import { registerGuildBatchSyncHandler } from './guild-batch-sync'
import { registerRosterBackfillHandler } from './roster-backfill'
import { registerGuildSyncHandler } from './guild-sync'
import { registerGuildHistoricalBackfillHandler } from './guild-historical-backfill'
import { registerRosterLokiBackfillHandler } from './roster-loki-backfill'
import { registerReconcileGuildRanksHandler } from './reconcile-guild-ranks'
import { registerTokenAuditGuildHandler } from './token-audit-guild'

registerSeasonTransitionMonitorHandler()
registerGuildBatchSyncHandler()
registerRosterBackfillHandler()
registerGuildSyncHandler()
registerGuildHistoricalBackfillHandler()
registerRosterLokiBackfillHandler()
registerReconcileGuildRanksHandler()
registerTokenAuditGuildHandler()

export {}

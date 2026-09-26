// Imported for side effects by app/api/worker/hooks; dormant until pg_cron enqueues its job_type.

import { registerDiscordLeaderboardHandlers } from './discord-leaderboard-update'
import { registerDailyAlertSummaryHandler } from './daily-alert-summary'
import { registerRefreshMetaAtlasHandler } from './refresh-meta-atlas'
import { registerRefreshExploreSnapshotsHandler } from './refresh-explore-snapshots'
import { registerSyncSchedulerHandler } from './sync-scheduler'
import { registerUserTokenAlertScanHandler } from './user-token-alert-scan'
import { registerUserBanReconcileHandler } from './user-ban-reconcile'

registerDiscordLeaderboardHandlers()
registerDailyAlertSummaryHandler()
registerRefreshMetaAtlasHandler()
registerRefreshExploreSnapshotsHandler()
registerSyncSchedulerHandler()
registerUserTokenAlertScanHandler()
registerUserBanReconcileHandler()

export {}

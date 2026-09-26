// Public surface of ./db-operations/; do not deep-import.
export {
  BATCH_CONFIG,
  getErrorMessage,
  isRecentTimestamp
} from '@/app/lib/sync/db-operations/shared'
export {
  fetchBossMappings,
  analyzeBossMappingCoverage,
  validateBossMappings
} from '@/app/lib/sync/db-operations/boss-mappings'

export {
  getRecentPlayerActivity,
  beginGuildRosterObservation,
  markPlayersNotInGuildAsInactive,
  savePlayerMappings
} from '@/app/lib/sync/db-operations/player-mappings'
export { trackUnitIds } from '@/app/lib/sync/db-operations/unit-tracking'

export { updateBombTracking } from '@/app/lib/sync/db-operations/bomb-tracking'
export { upsertDataBatches } from '@/app/lib/sync/db-operations/raid-upsert'

export {
  updateSyncStatus,
  updateGuildConfigAfterSync
} from '@/app/lib/sync/db-operations/sync-status'
export { loadExistingPlayerMappings } from '@/app/lib/sync/db-operations/player-mappings'
export { buildSyncSuccessResponse } from '@/app/lib/sync/db-operations/sync-response'

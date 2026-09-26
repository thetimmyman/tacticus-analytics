import 'server-only'
import {
  prependRolePings,
  appendRolePings
} from '@/app/lib/discord/role-mentions'
import {
  buildEmojiResolver,
  loadHeroEmojiMap
} from '@/app/lib/discord/emoji-resolver'
import { buildBossId } from '@/app/lib/resolvers/boss-identity'
import {
  DEFAULT_RARITY_FILTER,
  DEFAULT_RECENCY_WINDOW_MS,
  HERALD_WEBHOOK_TYPE,
  DISCORD_SNOWFLAKE_REGEX,
  CHANNEL_FANOUT_DELAY_MS,
  COMBINE_PRIME_WINDOW_MS
} from './contracts'
import {
  heraldBossIdToPlaybookSlug,
  heraldBossIdToCatalogBossUnitId,
  parseReplayStageToken,
  rarityToRaritySet,
  mainBossIdForGroup
} from './boss-slug'
import {
  formatDefeatMessage,
  formatDefeatEmbed,
  formatBombRangeEmbed,
  formatAvailabilityMessage,
  formatAvailabilityEmbed,
  formatAvailabilityCompactMessage,
  isMowToken
} from './format'
import {
  normalizeCompletedOn,
  collapseCombinedPrimeDefeats,
  collapseCombinedPrimeAvailabilities,
  detectBombRangeTransitions
} from './detect'
import {
  sanitizeRoleId,
  filterRoleIdsForBoss,
  resolveHeraldWebhook,
  resolveChannelsForTransition,
  resolveRoleIdsForTransition,
  normalizeExtraEntries,
  pingedMetaTeamNamesForBoss,
  AUTO_UPDATE_THROTTLE_MS,
  refreshAutoUpdateMappings
} from './config'
import {
  resolveDefeatPingMode,
  isPrimeSkipped,
  loadSkippedPrimesForSeasons,
  loadKillThresholdsForSeasons,
  loadBossDisplayNameOverrides,
  mergeCombinedPrimeNotes
} from './season-state'
import { postHeraldBombRangeEvent } from './dispatch'

export type {
  HeraldBattle,
  AvailabilityTransition,
  BombRangeTransition
} from './contracts'

export {
  detectDefeatTransitions,
  detectAvailabilityTransitions
} from './detect'

export type { HeraldBossConfigRow } from './config'
export {
  postHeraldEvent,
  postHeraldBombRangeEvent,
  postHeraldAvailabilityEvent
} from './dispatch'

export {
  composeHeraldPreview,
  postHeraldTestMessage,
  postHeraldManualOverride,
  MANUAL_OVERRIDE_AUDIT_ROLE
} from './preview'
export type { HeraldRunResult, RunHeraldForSyncParams } from './run-types'
export { createEmptyHeraldRunResult } from './run-types'
export { dispatchDefeatPhase } from './run-phases/defeat'
export { dispatchAvailabilityPhase } from './run-phases/availability'
export { dispatchBombRangePhase } from './run-phases/bomb-range'
export type {
  TestFireKind,
  HeraldPrimeState,
  ManualOverridePrime,
  ManualOverrideParams
} from './preview'

export { buildEmojiResolver, loadHeroEmojiMap }

/** Called by the sync route. Never throws, so Herald failures cannot affect sync. */
export { runHeraldForSync } from './run-sync'

export const __testing = {
  normalizeCompletedOn,
  buildBossId,
  formatDefeatMessage,
  sanitizeRoleId,
  prependRolePings,
  appendRolePings,
  filterRoleIdsForBoss,
  refreshAutoUpdateMappings,
  normalizeExtraEntries,
  resolveRoleIdsForTransition,
  resolveChannelsForTransition,
  isMowToken,
  pingedMetaTeamNamesForBoss,
  resolveHeraldWebhook,
  formatDefeatEmbed,
  formatAvailabilityMessage,
  formatAvailabilityEmbed,
  formatAvailabilityCompactMessage,
  heraldBossIdToPlaybookSlug,
  heraldBossIdToCatalogBossUnitId,
  parseReplayStageToken,
  buildEmojiResolver,
  loadHeroEmojiMap,
  mergeCombinedPrimeNotes,
  loadSkippedPrimesForSeasons,
  isPrimeSkipped,
  loadKillThresholdsForSeasons,
  loadBossDisplayNameOverrides,
  rarityToRaritySet,
  mainBossIdForGroup,
  resolveDefeatPingMode,
  collapseCombinedPrimeDefeats,
  collapseCombinedPrimeAvailabilities,
  detectBombRangeTransitions,
  formatBombRangeEmbed,
  postHeraldBombRangeEvent,
  HERALD_WEBHOOK_TYPE,
  DEFAULT_RECENCY_WINDOW_MS,
  DEFAULT_RARITY_FILTER,
  DISCORD_SNOWFLAKE_REGEX,
  AUTO_UPDATE_THROTTLE_MS,
  CHANNEL_FANOUT_DELAY_MS,
  COMBINE_PRIME_WINDOW_MS
}

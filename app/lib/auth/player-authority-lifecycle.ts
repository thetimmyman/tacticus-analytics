import 'server-only'

import type { Json, TypedSupabaseClient } from '@tacticus/app-core/types'

type RpcError = { message?: string | null; code?: string | null }
type RpcResult = { data: Json; error: RpcError | null }
type UnregisteredRpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DISCORD_SNOWFLAKE = /^\d{17,20}$/

export type PlayerAuthorityLifecycleError = RpcError

export interface DiscordUnlinkPreparation {
  success: true
  unlinkId: string
  relinkNonce: string
  generation: number
  clearedMappings: number
  providerUnlinkRequired: boolean
  staleSyncBlocked: true
}

export interface DiscordUnlinkConfirmation {
  success: true
  unlinkId: string
  generation: number
  identityAbsent: true
  clearedMappings: number
  relinkRequiresNonce: true
}

export interface DiscordGenerationActivation {
  success: true
  unlinkId: string
  generation: number
  mappingId: number
  discordUserId: string
  freshGenerationActivated: true
}

export interface AccountDeletionPreparation {
  success: true
  clearedMappingCount: number
  deletedMappingCount: number
  subjectAuthorityBlocked: true
  revokedAttestations: number
  purgedLokiCredentialCount: number
  purgedLokiGuildCodes: string[]
  bindingRestorable: false
}

export interface PlayerMappingDeactivation {
  success: true
  guildCode: string
  requestedCount: number
  deactivatedCount: number
  deactivatedMappingIds: number[]
  revokedAttestations: number
  purgedLokiCredentialCount: number
  purgedLokiGuildCodes: string[]
  authorityCleared: true
  observationStale: boolean
}

export interface PlayerGuildDeletion {
  success: true
  guildId: number
  guildCode: string
  deletedMappingCount: number
  deletedInviteCount: number
  revokedAttestations: number
  authorityCleared: true
  guildDeleted: true
}

export interface PlayerGuildDeletionFailure {
  success: false
  error: string
  errorCode: 'NOT_FOUND' | 'PROTECTED_GUILD'
}

function isNonNegativeInteger(value: Json | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveInteger(value: Json | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isUuid(value: Json | undefined): value is string {
  return typeof value === 'string' && UUID.test(value)
}

function isNonEmptyString(
  value: Json | undefined,
  maxLength = 200
): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maxLength
  )
}

function parsePositiveIntegerArray(value: Json | undefined): number[] | null {
  if (!Array.isArray(value) || !value.every(isPositiveInteger)) return null
  const unique = [...new Set(value)]
  return unique.length === value.length ? unique : null
}

export function parseDiscordUnlinkPreparation(
  value: Json
): DiscordUnlinkPreparation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, Json | undefined>
  if (
    row.success !== true ||
    !isUuid(row.unlink_id) ||
    !isUuid(row.relink_nonce) ||
    !isPositiveInteger(row.generation) ||
    !isNonNegativeInteger(row.cleared_mappings) ||
    typeof row.provider_unlink_required !== 'boolean' ||
    row.stale_sync_blocked !== true
  ) {
    return null
  }
  return {
    success: true,
    unlinkId: row.unlink_id,
    relinkNonce: row.relink_nonce,
    generation: row.generation,
    clearedMappings: row.cleared_mappings,
    providerUnlinkRequired: row.provider_unlink_required,
    staleSyncBlocked: true
  }
}

export function parseDiscordUnlinkConfirmation(
  value: Json,
  expected: { unlinkId: string; generation: number }
): DiscordUnlinkConfirmation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, Json | undefined>
  if (
    row.success !== true ||
    row.unlink_id !== expected.unlinkId ||
    row.generation !== expected.generation ||
    row.identity_absent !== true ||
    !isNonNegativeInteger(row.cleared_mappings) ||
    row.relink_requires_nonce !== true
  ) {
    return null
  }
  return {
    success: true,
    unlinkId: expected.unlinkId,
    generation: expected.generation,
    identityAbsent: true,
    clearedMappings: row.cleared_mappings,
    relinkRequiresNonce: true
  }
}

export function parseDiscordGenerationActivation(
  value: Json,
  expected: { unlinkId: string; generation: number; discordUserId: string }
): DiscordGenerationActivation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, Json | undefined>
  if (
    row.success !== true ||
    row.unlink_id !== expected.unlinkId ||
    row.generation !== expected.generation ||
    !isPositiveInteger(row.mapping_id) ||
    row.discord_user_id !== expected.discordUserId ||
    !DISCORD_SNOWFLAKE.test(expected.discordUserId) ||
    row.fresh_generation_activated !== true
  ) {
    return null
  }
  return {
    success: true,
    unlinkId: expected.unlinkId,
    generation: expected.generation,
    mappingId: row.mapping_id,
    discordUserId: expected.discordUserId,
    freshGenerationActivated: true
  }
}

export function parseAccountDeletionPreparation(
  value: Json
): AccountDeletionPreparation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, Json | undefined>
  const purgedGuildCodes = Array.isArray(row.purged_loki_guild_codes)
    ? row.purged_loki_guild_codes
    : null
  if (
    row.success !== true ||
    !isNonNegativeInteger(row.cleared_mapping_count) ||
    !isNonNegativeInteger(row.deleted_mapping_count) ||
    row.subject_authority_blocked !== true ||
    !isNonNegativeInteger(row.revoked_attestations) ||
    !isNonNegativeInteger(row.purged_loki_credential_count) ||
    purgedGuildCodes === null ||
    !purgedGuildCodes.every((code): code is string =>
      isNonEmptyString(code, 64)
    ) ||
    new Set(purgedGuildCodes).size !== purgedGuildCodes.length ||
    purgedGuildCodes.length !== row.purged_loki_credential_count ||
    row.binding_restorable !== false
  ) {
    return null
  }
  return {
    success: true,
    clearedMappingCount: row.cleared_mapping_count,
    deletedMappingCount: row.deleted_mapping_count,
    subjectAuthorityBlocked: true,
    revokedAttestations: row.revoked_attestations,
    purgedLokiCredentialCount: row.purged_loki_credential_count,
    purgedLokiGuildCodes: purgedGuildCodes,
    bindingRestorable: false
  }
}

export function parsePlayerMappingDeactivation(
  value: Json,
  expected: { guildCode: string; requestedCount: number }
): PlayerMappingDeactivation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, Json | undefined>
  const mappingIds = parsePositiveIntegerArray(row.deactivated_mapping_ids)
  const purgedGuildCodes = Array.isArray(row.purged_loki_guild_codes)
    ? row.purged_loki_guild_codes
    : null
  if (
    row.success !== true ||
    row.guild_code !== expected.guildCode ||
    row.requested_count !== expected.requestedCount ||
    !isNonNegativeInteger(row.deactivated_count) ||
    row.deactivated_count > expected.requestedCount ||
    mappingIds === null ||
    mappingIds.length !== row.deactivated_count ||
    !isNonNegativeInteger(row.revoked_attestations) ||
    !isNonNegativeInteger(row.purged_loki_credential_count) ||
    purgedGuildCodes === null ||
    !purgedGuildCodes.every((code): code is string =>
      isNonEmptyString(code, 64)
    ) ||
    new Set(purgedGuildCodes).size !== purgedGuildCodes.length ||
    purgedGuildCodes.length !== row.purged_loki_credential_count ||
    row.authority_cleared !== true ||
    typeof row.observation_stale !== 'boolean' ||
    (row.observation_stale === true && row.deactivated_count !== 0) ||
    (row.observation_stale === false &&
      row.deactivated_count !== expected.requestedCount)
  ) {
    return null
  }
  return {
    success: true,
    guildCode: expected.guildCode,
    requestedCount: expected.requestedCount,
    deactivatedCount: row.deactivated_count,
    deactivatedMappingIds: mappingIds,
    revokedAttestations: row.revoked_attestations,
    purgedLokiCredentialCount: row.purged_loki_credential_count,
    purgedLokiGuildCodes: purgedGuildCodes,
    authorityCleared: true,
    observationStale: row.observation_stale
  }
}

export function parsePlayerGuildDeletion(
  value: Json,
  expectedGuildId: number
): PlayerGuildDeletion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, Json | undefined>
  if (
    row.success !== true ||
    row.guild_id !== expectedGuildId ||
    !isNonEmptyString(row.guild_code, 64) ||
    !isNonNegativeInteger(row.deleted_mapping_count) ||
    !isNonNegativeInteger(row.deleted_invite_count) ||
    !isNonNegativeInteger(row.revoked_attestations) ||
    row.authority_cleared !== true ||
    row.guild_deleted !== true
  ) {
    return null
  }
  return {
    success: true,
    guildId: expectedGuildId,
    guildCode: row.guild_code,
    deletedMappingCount: row.deleted_mapping_count,
    deletedInviteCount: row.deleted_invite_count,
    revokedAttestations: row.revoked_attestations,
    authorityCleared: true,
    guildDeleted: true
  }
}

export function parsePlayerGuildDeletionFailure(
  value: Json
): PlayerGuildDeletionFailure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, Json | undefined>
  if (
    row.success !== false ||
    !isNonEmptyString(row.error, 300) ||
    (row.error_code !== 'NOT_FOUND' && row.error_code !== 'PROTECTED_GUILD')
  ) {
    return null
  }
  return {
    success: false,
    error: row.error,
    errorCode: row.error_code
  }
}

function rpc(
  supabase: TypedSupabaseClient,
  name: string,
  args: Record<string, unknown> = {}
): PromiseLike<RpcResult> {
  const client = supabase as unknown as UnregisteredRpcClient
  return client.rpc(name, args)
}

function writeRpc(
  supabase: TypedSupabaseClient,
  name: string,
  args: Record<string, unknown> = {}
): PromiseLike<RpcResult> {
  return rpc(supabase, name, args)
}

export function prepareDiscordIdentityUnlink(
  supabase: TypedSupabaseClient
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'prepare_discord_identity_unlink')
}

export function confirmDiscordIdentityUnlink(
  supabase: TypedSupabaseClient,
  unlinkId: string
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'confirm_discord_identity_unlink', {
    p_unlink_id: unlinkId
  })
}

export function activateDiscordIdentityGeneration(
  supabase: TypedSupabaseClient,
  unlinkId: string,
  relinkNonce: string
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'activate_discord_identity_generation', {
    p_unlink_id: unlinkId,
    p_relink_nonce: relinkNonce
  })
}

export function preparePlayerAccountDeletion(
  supabase: TypedSupabaseClient,
  userId: string,
  reason: 'account_delete' | 'gdpr_erasure'
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'prepare_player_account_deletion', {
    p_user_id: userId,
    p_reason: reason
  })
}

export function deactivatePlayerMappings(
  supabase: TypedSupabaseClient,
  guildCode: string,
  playerIds: string[],
  source: string,
  observedAt: string
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'deactivate_player_mappings_observed', {
    p_guild_code: guildCode,
    p_player_ids: playerIds,
    p_reason: 'roster_deactivation',
    p_source: source,
    p_observed_at: observedAt
  })
}

export function deletePlayerGuild(
  supabase: TypedSupabaseClient,
  guildId: number,
  source: string
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'delete_player_guild', {
    p_guild_id: guildId,
    p_reason: 'guild_delete',
    p_source: source
  })
}

export function setPlayerAppAdminBulk(
  supabase: TypedSupabaseClient,
  userIds: string[],
  isAppAdmin: boolean
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'set_player_app_admin_bulk', {
    p_user_ids: userIds,
    p_is_app_admin: isAppAdmin
  })
}

export function createPlayerInviteCode(
  supabase: TypedSupabaseClient,
  mappingId: number,
  expiresAt: string
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'create_player_invite_code', {
    p_mapping_id: mappingId,
    p_expires_at: expiresAt
  })
}

export function listPlayerInviteCodes(
  supabase: TypedSupabaseClient,
  guildCode: string | null
): PromiseLike<RpcResult> {
  return rpc(supabase, 'list_player_invite_codes', {
    p_guild_code: guildCode
  })
}

export function listActivePlayerInviteCodes(
  supabase: TypedSupabaseClient,
  guildCode: string
): PromiseLike<RpcResult> {
  return rpc(supabase, 'list_active_player_invite_codes', {
    p_guild_code: guildCode
  })
}

export function revokePlayerInviteCode(
  supabase: TypedSupabaseClient,
  inviteId: string,
  reason: string
): PromiseLike<RpcResult> {
  return writeRpc(supabase, 'revoke_player_invite_code', {
    p_invite_id: inviteId,
    p_reason: reason
  })
}

import { createHash } from 'node:crypto'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { decryptApiKey } from '@tacticus/app-core/encryption'
import { normalizeTacticusGuildRole } from '@tacticus/app-core/role-utils'
import { Errors } from '@/app/lib/errors/AppError'
import { tacticusAPI, type TacticusGuild } from '@/app/lib/api/tacticus-client'
import { invalidateClusterCache } from '@tacticus/app-core/cluster-cache'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger(
  'onboarding.guild-membership-reconciliation'
)

type ServiceClient = TypedSupabaseClient

export interface GuildConflictCandidate {
  mappingId: number
  playerId: string
  sourceGuildCode: string
  sourceGuildId: string
}

export interface GuildConflictResolution {
  reconciled: boolean
  sourceGuildCode?: string
  targetGuildCode?: string
}

type ReconcileRpcResult = {
  success?: boolean
  idempotent?: boolean
  error_code?: string
  guild_code?: string
}

/** `getGuild` does not validate `members`; a malformed roster yields zero matches, not a 500. */
function exactlyOnceOnRoster(guild: TacticusGuild, playerId: string) {
  const members = Array.isArray(guild?.members) ? guild.members : []
  return members.filter(
    (member) =>
      member && typeof member === 'object' && member.userId === playerId
  )
}

/** Runs before create-config's roster sync; only a witness pointer (the RPC rechecks under a lock). */
export async function captureGuildConflict({
  service,
  userId,
  targetGuildId
}: {
  service: ServiceClient
  userId: string
  targetGuildId: string
}): Promise<GuildConflictCandidate | null> {
  const { data, error } = await service
    .from('player_mapping')
    .select('id, player_id, guild_code')
    .eq('user_id', userId)
    .eq('is_current', true)

  if (error) {
    throw Errors.fromResponse(503, {
      error: 'Unable to verify your current guild membership. Please retry.'
    })
  }

  const rows = (data ?? []) as Array<{
    id: number
    player_id: string
    guild_code: string
  }>
  if (rows.length === 0) return null
  const current = rows[0]
  if (rows.length !== 1 || current === undefined) {
    throw Errors.conflict(
      'Your account has conflicting current guild profiles. Contact support before registering another guild.'
    )
  }
  const { data: sourceGuild, error: sourceError } = await service
    .from('guild_config')
    .select('guild_id')
    .eq('guild_code', current.guild_code)
    .maybeSingle()

  if (sourceError || !sourceGuild?.guild_id) {
    throw Errors.fromResponse(409, {
      error:
        'We found your existing guild profile but could not verify that guild with Tacticus. Contact support.'
    })
  }
  if (sourceGuild.guild_id === targetGuildId) return null

  return {
    mappingId: current.id,
    playerId: current.player_id,
    sourceGuildCode: current.guild_code,
    sourceGuildId: sourceGuild.guild_id
  }
}

/** Moves the mapping only when Tacticus shows the new key resolves to the target guild, the player is
 * on it exactly once as leader/officer, and the old credential no longer lists them or followed.
 * Any outage, third guild, duplicate or dual membership fails closed. */
export async function reconcileGuildConflict({
  service,
  userId,
  apiKey,
  attemptGeneration,
  targetGuildCode,
  targetGuildId,
  candidate
}: {
  service: ServiceClient
  userId: string
  apiKey: string
  attemptGeneration: number
  targetGuildCode: string
  targetGuildId: string
  candidate: GuildConflictCandidate | null
}): Promise<GuildConflictResolution> {
  if (!candidate) return { reconciled: false }

  const { data: targetConfig, error: targetConfigError } = await service
    .from('guild_config')
    .select('guild_id')
    .eq('guild_code', targetGuildCode)
    .maybeSingle()
  if (
    targetConfigError ||
    !targetConfig?.guild_id ||
    targetConfig.guild_id !== targetGuildId
  ) {
    throw Errors.conflict(
      'The newly registered guild identity changed while we were verifying it. Please retry.'
    )
  }

  const { data: sourceConfig, error: sourceConfigError } = await service
    .from('guild_config')
    .select('guild_id, api_key_encrypted')
    .eq('guild_code', candidate.sourceGuildCode)
    .maybeSingle()
  if (
    sourceConfigError ||
    !sourceConfig?.guild_id ||
    sourceConfig.guild_id !== candidate.sourceGuildId ||
    !sourceConfig.api_key_encrypted
  ) {
    throw Errors.conflict(
      'We could not verify your former guild credentials. Contact support to reconcile your membership.'
    )
  }

  let sourceApiKey: string
  try {
    sourceApiKey = (await decryptApiKey(sourceConfig.api_key_encrypted)).trim()
  } catch (error) {
    logger.error(
      { err: error, sourceGuildCode: candidate.sourceGuildCode },
      'Could not decrypt the former guild credential during reconciliation'
    )
    throw Errors.fromResponse(503, {
      error:
        'We could not verify your former guild credentials. Please retry or contact support.'
    })
  }

  let targetGuild: TacticusGuild | null
  let sourceCredentialGuild: TacticusGuild | null
  try {
    ;[targetGuild, sourceCredentialGuild] = await Promise.all([
      tacticusAPI.getGuild(apiKey),
      tacticusAPI.getGuild(sourceApiKey)
    ])
  } catch (error) {
    logger.warn(
      { err: error, sourceGuildCode: candidate.sourceGuildCode },
      'Tacticus roster verification failed during guild reconciliation'
    )
    throw Errors.fromResponse(503, {
      error:
        'Tacticus could not verify both guild rosters. Please retry in a few minutes.'
    })
  }
  if (!targetGuild?.guildId || !sourceCredentialGuild?.guildId) {
    throw Errors.fromResponse(503, {
      error:
        'Tacticus did not return both guild rosters needed to resolve your membership. Please retry.'
    })
  }
  if (targetGuild.guildId !== targetGuildId) {
    throw Errors.conflict(
      'The submitted API key no longer belongs to the guild being registered. Please retry with the current key.'
    )
  }

  const targetMatches = exactlyOnceOnRoster(targetGuild, candidate.playerId)
  const targetMatch = targetMatches[0]
  if (targetMatches.length !== 1 || targetMatch === undefined) {
    throw Errors.conflict(
      'Tacticus did not identify your player exactly once in the new guild. Contact support if the roster is still updating.'
    )
  }
  const targetRole = normalizeTacticusGuildRole(targetMatch.role)
  if (targetRole !== 'leader' && targetRole !== 'officer') {
    throw Errors.forbidden(
      'Your Tacticus profile is not a leader or co-leader of the new guild.'
    )
  }

  const sourceCredentialStayedWithSource =
    sourceCredentialGuild.guildId === candidate.sourceGuildId
  const sourceCredentialFollowedToTarget =
    sourceCredentialGuild.guildId === targetGuildId
  if (!sourceCredentialStayedWithSource && !sourceCredentialFollowedToTarget) {
    throw Errors.conflict(
      'The former guild credential now resolves to a third guild, so membership is ambiguous. Contact support.'
    )
  }
  if (
    sourceCredentialStayedWithSource &&
    exactlyOnceOnRoster(sourceCredentialGuild, candidate.playerId).length !== 0
  ) {
    throw Errors.conflict(
      'Tacticus still lists your player in the former guild. Wait for the roster change to finish, then retry.'
    )
  }

  const evidenceDigest = createHash('sha256')
    .update(
      JSON.stringify({
        v: 1,
        attemptGeneration,
        userId,
        mappingId: candidate.mappingId,
        playerId: candidate.playerId,
        sourceGuildCode: candidate.sourceGuildCode,
        sourceGuildId: candidate.sourceGuildId,
        sourceCredentialGuildId: sourceCredentialGuild.guildId,
        targetGuildCode,
        targetGuildId,
        targetRole
      })
    )
    .digest('hex')

  const { data: rpcData, error: rpcError } = await service.rpc(
    'reconcile_own_guild_membership',
    {
      p_subject: userId,
      p_player_id: candidate.playerId,
      p_source_guild: candidate.sourceGuildCode,
      p_source_guild_id: candidate.sourceGuildId,
      p_target_guild: targetGuildCode,
      p_target_guild_id: targetGuildId,
      p_target_role: targetRole,
      p_upstream_digest: evidenceDigest,
      p_attempt_generation: attemptGeneration
    }
  )
  if (rpcError) {
    logger.error(
      { err: rpcError, sourceGuildCode: candidate.sourceGuildCode },
      'Guild membership reconciliation RPC failed'
    )
    throw Errors.fromResponse(503, {
      error: 'Unable to save the verified guild membership. Please retry.'
    })
  }

  const result = rpcData as ReconcileRpcResult | null
  if (!result?.success) {
    const superseded = result?.error_code === 'ATTEMPT_SUPERSEDED'
    const retryable = new Set([
      'SOURCE_CHANGED',
      'SOURCE_NOT_EXACT',
      'GUILD_ROWS_CHANGED',
      'SOURCE_GUILD_ID_CHANGED',
      'TARGET_GUILD_ID_CHANGED',
      'ATTEMPT_SUPERSEDED'
    ])
    throw Errors.fromResponse(
      retryable.has(result?.error_code ?? '') ? 409 : 500,
      {
        error: superseded
          ? 'A newer guild registration request superseded this one. Refresh onboarding to see the latest result.'
          : retryable.has(result?.error_code ?? '')
            ? 'Your guild membership changed during verification. Please retry.'
            : 'The verified guild membership could not be saved. Contact support.'
      }
    )
  }

  // The mapping moved guild; without this, caches resolve the FORMER guild for 5-15 min (TTL is the backstop).
  await invalidateClusterCache(userId)

  return {
    reconciled: true,
    sourceGuildCode: candidate.sourceGuildCode,
    targetGuildCode: result.guild_code ?? targetGuildCode
  }
}

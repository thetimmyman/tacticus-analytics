import 'server-only'

import { createHash } from 'node:crypto'
import type { Json, TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
import {
  credentialBanDuration,
  findActivelyBannedAuthUserIds
} from '@/app/lib/auth/user-bans'
import {
  canonicalizeUserBanAuthUserId,
  withUserBanLocks
} from '@/app/lib/auth/user-ban-lock'
import { setPlayerAppAdminBulk } from '@/app/lib/auth/player-authority-lifecycle'

const logger = createComponentLogger('lib.auth.user-ban-reconciliation')
export const USER_BAN_RECONCILIATION_JOB_TYPE = 'user-ban-reconcile'

export interface UserBanReconciliationPayload {
  lockUserIds: string[]
  adminCandidateUserIds: string[]
  credentialUserIds: string[]
}

function normalizeUserIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.map(canonicalizeUserBanAuthUserId))].sort()
}

export function normalizeUserBanReconciliationPayload(input: {
  lockUserIds: readonly string[]
  adminCandidateUserIds?: readonly string[]
  credentialUserIds?: readonly string[]
}): UserBanReconciliationPayload {
  const adminCandidateUserIds = normalizeUserIds(
    input.adminCandidateUserIds ?? []
  )
  const credentialUserIds = normalizeUserIds(input.credentialUserIds ?? [])
  const lockUserIds = normalizeUserIds([
    ...input.lockUserIds,
    ...adminCandidateUserIds,
    ...credentialUserIds
  ])
  if (lockUserIds.length === 0 || lockUserIds.length > 500) {
    throw new Error('Ban reconciliation requires 1-500 lock users')
  }
  return { lockUserIds, adminCandidateUserIds, credentialUserIds }
}

export function parseUserBanReconciliationPayload(
  value: Record<string, unknown>
): UserBanReconciliationPayload {
  const readIds = (key: keyof UserBanReconciliationPayload): string[] => {
    const candidate = value[key]
    if (
      !Array.isArray(candidate) ||
      !candidate.every((id) => typeof id === 'string')
    ) {
      throw new Error(`Invalid user-ban reconciliation payload: ${key}`)
    }
    return candidate
  }
  return normalizeUserBanReconciliationPayload({
    lockUserIds: readIds('lockUserIds'),
    adminCandidateUserIds: readIds('adminCandidateUserIds'),
    credentialUserIds: readIds('credentialUserIds')
  })
}

function reconciliationDedupeKey(
  payload: UserBanReconciliationPayload
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
  return `user-ban-reconcile:${digest}`
}

export async function enqueueUserBanReconciliation(
  supabase: TypedSupabaseClient,
  input: {
    lockUserIds: readonly string[]
    adminCandidateUserIds?: readonly string[]
    credentialUserIds?: readonly string[]
  }
): Promise<string> {
  const payload = normalizeUserBanReconciliationPayload(input)
  const jobs = payload.lockUserIds.map((userId) => {
    const userPayload = {
      lockUserIds: [userId],
      adminCandidateUserIds: payload.adminCandidateUserIds.includes(userId)
        ? [userId]
        : [],
      credentialUserIds: payload.credentialUserIds.includes(userId)
        ? [userId]
        : []
    }
    return {
      dedupeKey: reconciliationDedupeKey(userPayload),
      payload: userPayload
    }
  })

  // One transaction, so a partial repair never looks durable.
  const { error } = await supabase.rpc('enqueue_user_ban_reconciliation_jobs', {
    p_jobs: jobs as unknown as Json
  })
  if (error) {
    logger.error({ error }, 'Failed to persist ban reconciliation batch')
    throw new Error(`Failed to persist ban reconciliation: ${error.message}`)
  }
  return jobs[0]?.dedupeKey ?? reconciliationDedupeKey(payload)
}

async function findCurrentMappedAppAdminUserIds(
  supabase: TypedSupabaseClient,
  candidateUserIds: readonly string[]
): Promise<string[]> {
  if (candidateUserIds.length === 0) return []
  const { data, error } = await supabase
    .from('player_mapping')
    .select('user_id')
    .in('user_id', [...candidateUserIds])
    .eq('is_current', true)
    .eq('is_app_admin', true)
  if (error) {
    throw new Error(`Ban admin compensation lookup failed: ${error.message}`)
  }
  return normalizeUserIds(
    (data ?? [])
      .map(({ user_id }) => user_id)
      .filter((userId): userId is string => typeof userId === 'string')
  )
}

function hasExactUpdatedUsers(data: Json, expectedUserIds: string[]): boolean {
  if (!Array.isArray(data)) return false
  const actual = data.map((row) =>
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>).user_id
      : null
  )
  if (!actual.every((userId): userId is string => typeof userId === 'string')) {
    return false
  }
  const normalizedActual = normalizeUserIds(actual)
  return (
    actual.length === expectedUserIds.length &&
    normalizedActual.length === expectedUserIds.length &&
    normalizedActual.every((userId, index) => userId === expectedUserIds[index])
  )
}

export async function reconcileUserBanState(
  supabase: TypedSupabaseClient,
  rawPayload: UserBanReconciliationPayload,
  options: {
    operationSupabase?: TypedSupabaseClient
    signal?: AbortSignal
  } = {}
): Promise<{ adminsRevoked: number; credentialsReconciled: number }> {
  const payload = normalizeUserBanReconciliationPayload(rawPayload)
  const operationSupabase = options.operationSupabase ?? supabase
  return withUserBanLocks(
    supabase,
    payload.lockUserIds,
    async (leases) => {
      await Promise.all(leases.map((lease) => lease.assertHeld()))

      const bannedUserIds =
        payload.adminCandidateUserIds.length > 0
          ? await findActivelyBannedAuthUserIds(
              payload.adminCandidateUserIds,
              operationSupabase
            )
          : []
      const bannedAdminUserIds = await findCurrentMappedAppAdminUserIds(
        operationSupabase,
        bannedUserIds
      )
      if (bannedAdminUserIds.length > 0) {
        const result = await setPlayerAppAdminBulk(
          operationSupabase,
          bannedAdminUserIds,
          false
        )
        if (
          result.error ||
          !hasExactUpdatedUsers(result.data, bannedAdminUserIds)
        ) {
          throw new Error(
            result.error?.message ||
              'Ban reconciliation did not revoke the exact banned admin set'
          )
        }
      }

      for (const userId of payload.credentialUserIds) {
        const nowIso = new Date().toISOString()
        const { data, error } = await operationSupabase
          .from('user_bans')
          .select('expires_at')
          .eq('auth_user_id', userId)
          .is('lifted_at', null)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        if (error) {
          throw new Error(
            `Credential reconciliation lookup failed: ${error.message}`
          )
        }
        const { error: credentialError } =
          await operationSupabase.auth.admin.updateUserById(userId, {
            ban_duration: credentialBanDuration(data ?? [])
          })
        if (credentialError) {
          throw new Error(
            `Credential reconciliation update failed: ${credentialError.message}`
          )
        }
      }

      await Promise.all(leases.map((lease) => lease.assertHeld()))
      return {
        adminsRevoked: bannedAdminUserIds.length,
        credentialsReconciled: payload.credentialUserIds.length
      }
    },
    options.signal
  )
}

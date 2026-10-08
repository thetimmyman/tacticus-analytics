import 'server-only'

import { randomUUID } from 'node:crypto'
import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('lib.auth.user-ban-lock')
const LOCK_TTL_MS = 2 * 60 * 1000
const LOCK_HEARTBEAT_MS = 30 * 1000
const LOST_LEASE_RETRY_MS = 250
const AUTH_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export class UserBanOperationInProgressError extends Error {
  constructor() {
    super('Another ban operation is already in progress for this user')
    this.name = 'UserBanOperationInProgressError'
  }
}

export class UserBanLockLostError extends Error {
  constructor(message = 'The ban operation lock was lost; refresh and retry') {
    super(message)
    this.name = 'UserBanLockLostError'
  }
}

export class InvalidUserBanAuthUserIdError extends Error {
  constructor() {
    super('A valid auth user ID is required')
    this.name = 'InvalidUserBanAuthUserIdError'
  }
}

/** Canonicalize case, or one user could hold two leases. */
export function canonicalizeUserBanAuthUserId(userId: string): string {
  const canonical = userId.trim().toLowerCase()
  if (!AUTH_USER_ID_PATTERN.test(canonical)) {
    throw new InvalidUserBanAuthUserIdError()
  }
  return canonical
}

interface UserBanLock {
  lockKey: string
  lockId: string
}

export interface UserBanLockLease {
  assertHeld: () => Promise<void>
}

async function renewUserBanLock(
  supabase: ServiceSupabaseClient,
  lock: UserBanLock
): Promise<void> {
  const now = new Date()
  const { data, error } = await supabase
    .from('execution_locks')
    .update({
      heartbeat_at: now.toISOString(),
      expires_at: new Date(now.getTime() + LOCK_TTL_MS).toISOString()
    })
    .eq('lock_key', lock.lockKey)
    .eq('lock_id', lock.lockId)
    .gt('expires_at', now.toISOString())
    .select('lock_id')
    .maybeSingle()

  if (error) {
    logger.error({ error, lockKey: lock.lockKey }, 'Ban lock renewal failed')
    // A failed renewal may still have committed; treat it as lease loss so callers reconcile.
    throw new UserBanLockLostError(
      'The ban operation lock could not be renewed; ownership is uncertain'
    )
  }
  if (!data) {
    logger.error({ lockKey: lock.lockKey }, 'Ban lock ownership was lost')
    throw new UserBanLockLostError()
  }
}

async function acquireUserBanLock(
  supabase: ServiceSupabaseClient,
  userId: string
): Promise<UserBanLock | null> {
  const canonicalUserId = canonicalizeUserBanAuthUserId(userId)
  const lockKey = `user_ban_${canonicalUserId}`
  const lockId = randomUUID()
  const now = new Date()

  const { error: cleanupError } = await supabase
    .from('execution_locks')
    .delete()
    .eq('lock_key', lockKey)
    .lt('expires_at', now.toISOString())

  if (cleanupError) {
    logger.error(
      { error: cleanupError, userId: canonicalUserId },
      'Ban lock cleanup failed'
    )
    throw new Error('Unable to coordinate the ban operation')
  }

  const { error } = await supabase.from('execution_locks').insert({
    lock_key: lockKey,
    lock_id: lockId,
    guild_code: null,
    worker_id: `admin-ban:${lockId}`,
    acquired_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: new Date(now.getTime() + LOCK_TTL_MS).toISOString()
  })

  if (!error) return { lockKey, lockId }
  if (error.code === '23505') return null

  logger.error(
    { error, userId: canonicalUserId },
    'Ban lock acquisition failed'
  )
  throw new Error('Unable to coordinate the ban operation')
}

async function releaseUserBanLock(
  supabase: ServiceSupabaseClient,
  lock: UserBanLock
): Promise<void> {
  const { error } = await supabase
    .from('execution_locks')
    .delete()
    .eq('lock_key', lock.lockKey)
    .eq('lock_id', lock.lockId)

  if (error) {
    // The short expiry prevents deadlock; admin remediation is blocked meanwhile.
    logger.error({ error, lockKey: lock.lockKey }, 'Ban lock release failed')
  }
}

export async function withUserBanLock<T>(
  supabase: ServiceSupabaseClient,
  userId: string,
  operation: (lease: UserBanLockLease) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const lock = await acquireUserBanLock(supabase, userId)
  if (!lock) throw new UserBanOperationInProgressError()

  // Heartbeat keeps the lease alive during slow GoTrue calls; renewal is serialized
  // so an ownership assertion cannot pass an older in-flight heartbeat.
  let renewal = Promise.resolve()
  let renewalFailure: Error | null = null
  const throwIfAborted = () => {
    if (!signal?.aborted) return
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Ban reconciliation aborted')
  }
  const queueRenewal = async (): Promise<void> => {
    throwIfAborted()
    renewal = renewal.then(async () => {
      if (renewalFailure) return
      try {
        await renewUserBanLock(supabase, lock)
      } catch (error) {
        renewalFailure =
          error instanceof UserBanLockLostError
            ? error
            : new UserBanLockLostError(
                'The ban operation lock renewal failed unexpectedly; ownership is uncertain'
              )
      }
    })
    await renewal
    if (renewalFailure) throw renewalFailure
  }
  const timer = setInterval(() => {
    void queueRenewal().catch(() => {
      // Surfaced at the next ownership assertion.
    })
  }, LOCK_HEARTBEAT_MS)
  timer.unref?.()
  const stopHeartbeat = () => clearInterval(timer)
  signal?.addEventListener('abort', stopHeartbeat, { once: true })

  const lease: UserBanLockLease = { assertHeld: queueRenewal }

  try {
    let result: T
    try {
      result = await operation(lease)
    } catch (operationError) {
      // Re-assert before rethrowing: the call may have committed despite failing.
      await lease.assertHeld()
      throw operationError
    }
    await lease.assertHeld()
    return result
  } finally {
    clearInterval(timer)
    signal?.removeEventListener('abort', stopHeartbeat)
    await renewal.catch(() => undefined)
    await releaseUserBanLock(supabase, lock)
  }
}

/** Acquires in stable order to avoid lock-order deadlocks. */
export async function withUserBanLocks<T>(
  supabase: ServiceSupabaseClient,
  userIds: readonly string[],
  operation: (leases: readonly UserBanLockLease[]) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const orderedUserIds = [
    ...new Set(userIds.map(canonicalizeUserBanAuthUserId))
  ].sort()

  const acquireNext = async (
    index: number,
    leases: readonly UserBanLockLease[]
  ): Promise<T> => {
    const userId = orderedUserIds[index]
    if (!userId) return operation(leases)
    return withUserBanLock(
      supabase,
      userId,
      (lease) => acquireNext(index + 1, [...leases, lease]),
      signal
    )
  }

  return acquireNext(0, [])
}

/**
 * Compensates only under a fresh lease. No time cutoff: a successor can renew
 * past the TTL, and abandoning compensation would violate the ban invariant.
 */
export async function withUserBanLocksAfterLeaseLoss<T>(
  supabase: ServiceSupabaseClient,
  userIds: readonly string[],
  operation: (leases: readonly UserBanLockLease[]) => Promise<T>
): Promise<T> {
  for (;;) {
    try {
      return await withUserBanLocks(supabase, userIds, operation)
    } catch (error) {
      if (error instanceof InvalidUserBanAuthUserIdError) {
        throw error
      }
      // Keep retrying: this is the only reconciliation for a write that crossed a lost lease.
      if (
        !(error instanceof UserBanOperationInProgressError) &&
        !(error instanceof UserBanLockLostError)
      ) {
        logger.error(
          { error, userIds },
          'Ban lease-loss compensation failed; retrying'
        )
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, LOST_LEASE_RETRY_MS)
      )
    }
  }
}

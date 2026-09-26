import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAuthError } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { credentialBanDuration } from '@/app/lib/auth/user-bans'
import {
  UserBanLockLostError,
  UserBanOperationInProgressError,
  withUserBanLock,
  withUserBanLocksAfterLeaseLoss
} from '@/app/lib/auth/user-ban-lock'
import { enqueueUserBanReconciliation } from '@/app/lib/auth/user-ban-reconciliation'

const logger = createComponentLogger('api.admin.users.bans.lift')
const LEGACY_ADMIN_DENIED_METADATA = { error: 'Admin access required' }

async function compensateCredentialAfterLostLease(
  supabase: ReturnType<typeof serviceDb>,
  userId: string
): Promise<void> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('user_bans')
    .select('expires_at')
    .eq('auth_user_id', userId)
    .is('lifted_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)

  if (error)
    throw new Error(`Credential compensation lookup failed: ${error.message}`)

  const { error: credentialError } = await supabase.auth.admin.updateUserById(
    userId,
    {
      ban_duration: credentialBanDuration(data ?? [])
    }
  )
  if (credentialError) {
    throw new Error(
      `Credential compensation update failed: ${credentialError.message}`
    )
  }
}

/** Soft close keeps history and allows a re-ban. Lifts a whole GROUP: a partial lift leaves the user banned. */
export const POST = withAdminGuards(
  {
    guard: 'app-admin',
    deniedMetadata: LEGACY_ADMIN_DENIED_METADATA
  },
  async (request: NextRequest, _context, { profile }) => {
    try {
      const body = await request.json()
      const { ban_group_id, lift_reason } = body

      if (typeof ban_group_id !== 'string' || !ban_group_id) {
        throw Errors.fromResponse(400, { error: 'ban_group_id is required' })
      }

      const supabase = serviceDb()
      const { data: groupRows, error: groupError } = await supabase
        .from('user_bans')
        .select('auth_user_id')
        .eq('ban_group_id', ban_group_id)
        .is('lifted_at', null)

      if (groupError) {
        logger.error({ error: groupError, ban_group_id }, 'Ban lookup failed')
        throw Errors.fromResponse(500, { error: groupError.message })
      }
      const authUserIds = [
        ...new Set((groupRows ?? []).map((row) => row.auth_user_id))
      ]
      if (authUserIds.length === 0) {
        throw Errors.fromResponse(404, {
          error: 'No active ban found for that ban group'
        })
      }
      if (authUserIds.length !== 1) {
        throw Errors.fromResponse(409, {
          error: 'Ban group contains inconsistent auth users'
        })
      }
      let credentialMutationAttempted = false

      return await withUserBanLock(supabase, authUserIds[0]!, async (lease) => {
        // The group may have been lifted since discovery.
        const { data: lockedGroupRows, error: lockedGroupError } =
          await supabase
            .from('user_bans')
            .select('auth_user_id')
            .eq('ban_group_id', ban_group_id)
            .is('lifted_at', null)

        if (lockedGroupError) {
          logger.error(
            { error: lockedGroupError, ban_group_id },
            'Locked ban lookup failed'
          )
          throw Errors.fromResponse(500, { error: lockedGroupError.message })
        }
        if (
          !lockedGroupRows?.length ||
          lockedGroupRows.some((row) => row.auth_user_id !== authUserIds[0])
        ) {
          throw Errors.fromResponse(409, {
            error: 'Ban changed while the lift was starting; refresh and retry'
          })
        }

        await lease.assertHeld()

        // Reconcile GoTrue while the ledger group is still active, so issued JWTs stay blocked throughout.
        const nowIso = new Date().toISOString()
        const { data: otherActiveRows, error: otherActiveError } =
          await supabase
            .from('user_bans')
            .select('expires_at')
            .eq('auth_user_id', authUserIds[0]!)
            .neq('ban_group_id', ban_group_id)
            .is('lifted_at', null)
            .or(`expires_at.is.null,expires_at.gt.${nowIso}`)

        if (otherActiveError) {
          logger.error(
            { error: otherActiveError, ban_group_id },
            'Remaining ban lookup failed'
          )
          throw Errors.fromResponse(500, { error: otherActiveError.message })
        }

        // GoTrue holds one duration: recompute it from every remaining group.
        credentialMutationAttempted = true
        const { error: credentialError } =
          await supabase.auth.admin.updateUserById(authUserIds[0]!, {
            ban_duration: credentialBanDuration(otherActiveRows ?? [])
          })
        if (credentialError) {
          logger.error(
            { error: credentialError, ban_group_id },
            'Credential ban reconciliation failed'
          )
          throw Errors.fromResponse(500, {
            error: 'Failed to reconcile user login access'
          })
        }
        // Keep the ledger active unless this request still holds the renewed lease.
        await lease.assertHeld()

        const liftedAt = new Date().toISOString()
        const { data, error } = await supabase
          .from('user_bans')
          .update({
            lifted_at: liftedAt,
            lifted_by: profile.user_id,
            lift_reason:
              typeof lift_reason === 'string' && lift_reason.trim()
                ? lift_reason.trim()
                : null
          })
          .eq('ban_group_id', ban_group_id)
          .is('lifted_at', null)
          .select('id')

        if (error) {
          logger.error(
            { error, ban_group_id },
            'Ban ledger close failed after credential reconciliation'
          )
          throw Errors.fromResponse(500, { error: error.message })
        }

        const liftedCount = data?.length ?? 0
        if (liftedCount !== lockedGroupRows.length) {
          logger.error(
            { ban_group_id, expected: lockedGroupRows.length, liftedCount },
            'Ban ledger close returned an incomplete group'
          )
          throw Errors.fromResponse(500, {
            error: 'Failed to close the complete ban group'
          })
        }

        await lease.assertHeld()

        logger.warn(
          { ban_group_id, liftedCount, lifted_by: profile.user_id },
          'Ban lifted'
        )

        return NextResponse.json({ success: true, liftedCount })
      }).catch(async (leaseError) => {
        // Correct whether ownership was lost before or after the close committed.
        if (
          leaseError instanceof UserBanLockLostError &&
          credentialMutationAttempted
        ) {
          await enqueueUserBanReconciliation(supabase, {
            lockUserIds: authUserIds,
            credentialUserIds: [authUserIds[0]!]
          })
          await withUserBanLocksAfterLeaseLoss(
            supabase,
            authUserIds,
            async (freshLeases) => {
              await Promise.all(
                freshLeases.map((freshLease) => freshLease.assertHeld())
              )
              await compensateCredentialAfterLostLease(
                supabase,
                authUserIds[0]!
              )
              await Promise.all(
                freshLeases.map((freshLease) => freshLease.assertHeld())
              )
            }
          )
        }
        throw leaseError
      })
    } catch (err) {
      if (err instanceof UserBanOperationInProgressError) {
        throw Errors.fromResponse(409, { error: err.message })
      }
      rethrowIfAppError(err)
      rethrowIfAuthError(err)
      logger.error({ error: err }, 'Ban lift exception')
      throw Errors.fromResponse(500, {
        error: err instanceof Error ? err.message : 'Internal error'
      })
    }
  }
)

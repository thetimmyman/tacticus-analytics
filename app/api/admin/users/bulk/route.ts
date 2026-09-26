import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import type { Json } from '@tacticus/app-core/types'
import { serviceDb } from '@/app/lib/db'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.admin.users.bulk')
import { rethrowIfAuthError } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { setPlayerAppAdminBulk } from '@/app/lib/auth/player-authority-lifecycle'
import { findActivelyBannedAuthUserIds } from '@/app/lib/auth/user-bans'
import { enqueueUserBanReconciliation } from '@/app/lib/auth/user-ban-reconciliation'
import {
  UserBanLockLostError,
  UserBanOperationInProgressError,
  withUserBanLocks,
  withUserBanLocksAfterLeaseLoss
} from '@/app/lib/auth/user-ban-lock'

const LEGACY_ADMIN_DENIED_METADATA = { error: 'Admin access required' }

function hasExactUpdatedUsers(
  data: Json,
  expectedUserIds: readonly string[]
): boolean {
  if (!Array.isArray(data)) return false
  const actual = data.map((row) =>
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>).user_id
      : null
  )
  if (!actual.every((userId): userId is string => typeof userId === 'string')) {
    return false
  }
  const normalizedActual = [...new Set(actual)].sort()
  const normalizedExpected = [...new Set(expectedUserIds)].sort()
  return (
    normalizedActual.length === actual.length &&
    normalizedActual.length === normalizedExpected.length &&
    normalizedActual.every(
      (userId, index) => userId === normalizedExpected[index]
    )
  )
}

export const POST = withAdminGuards(
  {
    guard: 'app-admin',
    deniedMetadata: LEGACY_ADMIN_DENIED_METADATA
  },
  async (request: NextRequest, _context, { profile }) => {
    try {
      const body = await request.json()
      const { action, role_type, user_ids, guild_code, notes } = body

      if (!action || !role_type) {
        throw Errors.fromResponse(400, {
          error: 'Action and role_type are required'
        })
      }

      if (!['add', 'remove'].includes(action)) {
        throw Errors.fromResponse(400, { error: 'Invalid action' })
      }

      if (!['alpha_tester', 'beta_tester', 'admin'].includes(role_type)) {
        throw Errors.fromResponse(400, { error: 'Invalid role_type' })
      }

      const supabase = serviceDb()
      let targetUserIds: string[] = []

      if (guild_code) {
        const { data: guildMembers, error: guildError } =
          await guildRosterQuery(supabase, guild_code, 'user_id').not(
            'user_id',
            'is',
            null
          )

        if (guildError) {
          throw Errors.fromResponse(500, { error: guildError.message })
        }

        targetUserIds = (guildMembers || [])
          .map((m) => m.user_id)
          .filter(Boolean) as string[]
      } else if (user_ids && Array.isArray(user_ids)) {
        targetUserIds = user_ids.filter(Boolean)
      }

      targetUserIds = [...new Set(targetUserIds)].sort()

      if (targetUserIds.length === 0) {
        throw Errors.fromResponse(400, { error: 'No valid users found' })
      }

      let successCount = 0
      let errorCount = 0
      const errors: string[] = []

      if (role_type === 'admin') {
        const adminTargetUserIds =
          action === 'remove'
            ? targetUserIds.filter((id) => id !== profile.user_id)
            : targetUserIds

        if (adminTargetUserIds.length === 0) {
          throw Errors.fromResponse(400, {
            error: 'Cannot remove yourself as admin'
          })
        }

        let adminGrantAttempted = false
        const { data, error } = await withUserBanLocks(
          supabase,
          adminTargetUserIds,
          async (leases) => {
            await Promise.all(leases.map((lease) => lease.assertHeld()))

            if (action === 'add') {
              const bannedUserIds = await findActivelyBannedAuthUserIds(
                adminTargetUserIds,
                supabase
              )
              if (bannedUserIds.length > 0) {
                throw Errors.fromResponse(409, {
                  error:
                    'Cannot grant app admin access to an actively banned user',
                  banned_user_ids: bannedUserIds
                })
              }
            }

            await Promise.all(leases.map((lease) => lease.assertHeld()))
            adminGrantAttempted = action === 'add'
            const result = await setPlayerAppAdminBulk(
              supabase,
              adminTargetUserIds,
              action === 'add'
            )
            await Promise.all(leases.map((lease) => lease.assertHeld()))
            return result
          }
        ).catch(async (leaseError) => {
          // Every lease is released before this catch; reacquiring inside would deadlock a multi-user grant.
          if (
            leaseError instanceof UserBanLockLostError &&
            adminGrantAttempted
          ) {
            await enqueueUserBanReconciliation(supabase, {
              lockUserIds: adminTargetUserIds,
              adminCandidateUserIds: adminTargetUserIds
            })
            await withUserBanLocksAfterLeaseLoss(
              supabase,
              adminTargetUserIds,
              async (freshLeases) => {
                await Promise.all(
                  freshLeases.map((freshLease) => freshLease.assertHeld())
                )
                const bannedUserIds = await findActivelyBannedAuthUserIds(
                  adminTargetUserIds,
                  supabase
                )
                if (bannedUserIds.length > 0) {
                  const compensation = await setPlayerAppAdminBulk(
                    supabase,
                    bannedUserIds,
                    false
                  )
                  if (
                    compensation.error ||
                    !hasExactUpdatedUsers(compensation.data, bannedUserIds)
                  ) {
                    throw new Error(
                      compensation.error?.message ||
                        'Admin grant compensation did not return the exact banned user set'
                    )
                  }
                }
                await Promise.all(
                  freshLeases.map((freshLease) => freshLease.assertHeld())
                )
              }
            )
          }
          throw leaseError
        })

        if (error) {
          errors.push(error.message || 'Bulk admin update failed')
          errorCount = adminTargetUserIds.length
        } else if (!hasExactUpdatedUsers(data, adminTargetUserIds)) {
          errors.push(
            'Admin update did not return the exact requested user set'
          )
          errorCount = adminTargetUserIds.length
        } else {
          successCount = adminTargetUserIds.length
        }
      } else {
        const accessLevel = role_type

        if (action === 'add') {
          const records = targetUserIds.map((user_id) => ({
            user_id,
            access_level: accessLevel,
            granted_at: new Date().toISOString(),
            notes: notes || null
          }))

          for (const record of records) {
            const { error } = await supabase
              .from('feature_access_grants')
              .upsert(record, { onConflict: 'user_id,access_level' })

            if (error) {
              errors.push(`Failed for user ${record.user_id}: ${error.message}`)
              errorCount++
            } else {
              successCount++
            }
          }
        } else {
          const { error } = await supabase
            .from('feature_access_grants')
            .delete()
            .in('user_id', targetUserIds)
            .eq('access_level', accessLevel)

          if (error) {
            errors.push(error.message)
            errorCount = targetUserIds.length
          } else {
            successCount = targetUserIds.length
          }
        }
      }

      return NextResponse.json({
        success: errorCount === 0,
        successCount,
        errorCount,
        totalProcessed: targetUserIds.length,
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined
      })
    } catch (err) {
      if (err instanceof UserBanOperationInProgressError) {
        throw Errors.fromResponse(409, { error: err.message })
      }
      rethrowIfAppError(err)
      rethrowIfAuthError(err)
      logger.error({ error: err }, 'Bulk operation exception')
      throw Errors.fromResponse(500, {
        error: err instanceof Error ? err.message : 'Internal error'
      })
    }
  }
)

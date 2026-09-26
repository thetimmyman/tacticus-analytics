import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import type { Json } from '@tacticus/app-core/types'
import { serviceDb } from '@/app/lib/db'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAuthError } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  BAN_SUBJECT_TYPES,
  credentialBanDuration,
  findActivelyBannedAuthUserIds,
  isBanSubjectType,
  normalizeBanSubjectValue,
  type BanSubjectType
} from '@/app/lib/auth/user-bans'
import {
  InvalidUserBanAuthUserIdError,
  UserBanLockLostError,
  UserBanOperationInProgressError,
  canonicalizeUserBanAuthUserId,
  withUserBanLocks,
  withUserBanLocksAfterLeaseLoss
} from '@/app/lib/auth/user-ban-lock'
import { extractDiscordIdentityClaims } from '@/app/lib/discord/identity-claims'
import { setPlayerAppAdminBulk } from '@/app/lib/auth/player-authority-lifecycle'
import { enqueueUserBanReconciliation } from '@/app/lib/auth/user-ban-reconciliation'

const logger = createComponentLogger('api.admin.users.bans')
const LEGACY_ADMIN_DENIED_METADATA = { error: 'Admin access required' }

const BAN_SELECT =
  'id,ban_group_id,auth_user_id,subject_type,subject_value,reason,banned_by,banned_at,expires_at,lifted_at,lifted_by,lift_reason'
const ACTIVE_PAGE_SIZE = 500
const DEFAULT_HISTORY_PAGE_SIZE = 100
const MAX_HISTORY_PAGE_SIZE = 200
const BAN_SUBJECT_LOCK_ORDER: Record<BanSubjectType, number> = {
  discord_user_id: 0,
  player_id: 1,
  user_id: 2,
  email: 3
}

interface HistoryCursor {
  bannedAt: string
  id: string
}

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function decodeHistoryCursor(raw: string | null): HistoryCursor | null {
  if (!raw) return null

  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      !Number.isFinite(Date.parse(value[0])) ||
      typeof value[1] !== 'string' ||
      !UUID_PATTERN.test(value[1])
    ) {
      throw new Error('invalid cursor shape')
    }
    return { bannedAt: value[0], id: value[1] }
  } catch {
    throw Errors.fromResponse(400, { error: 'Invalid history cursor' })
  }
}

function encodeHistoryCursor(row: { banned_at: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.banned_at, row.id])).toString(
    'base64url'
  )
}

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

async function findCurrentMappedAppAdminUserIds(
  supabase: ReturnType<typeof serviceDb>,
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

  return [
    ...new Set(
      (data ?? [])
        .map(({ user_id }) => user_id)
        .filter((userId): userId is string => typeof userId === 'string')
        .map(canonicalizeUserBanAuthUserId)
    )
  ].sort()
}

export const GET = withAdminGuards(
  {
    guard: 'app-admin',
    deniedMetadata: LEGACY_ADMIN_DENIED_METADATA
  },
  async (request: NextRequest) => {
    const historyCursor = decodeHistoryCursor(
      request.nextUrl.searchParams.get('history_cursor')
    )
    const requestedLimit = Number(
      request.nextUrl.searchParams.get('history_limit') ??
        DEFAULT_HISTORY_PAGE_SIZE
    )
    const historyLimit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_HISTORY_PAGE_SIZE)
        : DEFAULT_HISTORY_PAGE_SIZE
    const nowIso = new Date().toISOString()
    const supabase = serviceDb()
    const activeBans: unknown[] = []
    let activeCursor: HistoryCursor | null = null

    // Active rows come back in full so no indefinite ban hides behind pagination.
    for (;;) {
      let activeQuery = supabase
        .from('user_bans')
        .select(BAN_SELECT)
        .is('lifted_at', null)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)

      if (activeCursor) {
        activeQuery = activeQuery.or(
          `banned_at.lt.${activeCursor.bannedAt},and(banned_at.eq.${activeCursor.bannedAt},id.gt.${activeCursor.id})`
        )
      }

      const { data, error } = await activeQuery
        .order('banned_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(ACTIVE_PAGE_SIZE)

      if (error) {
        logger.error({ error }, 'Active ban list query failed')
        throw Errors.fromResponse(500, { error: error.message })
      }
      activeBans.push(...(data ?? []))
      if ((data?.length ?? 0) < ACTIVE_PAGE_SIZE) break
      const lastRow = data?.at(-1)
      if (!lastRow) break
      activeCursor = { bannedAt: lastRow.banned_at, id: lastRow.id }
    }

    let historyQuery = supabase
      .from('user_bans')
      .select(BAN_SELECT)
      .or(`lifted_at.not.is.null,expires_at.lte.${nowIso}`)

    if (historyCursor) {
      historyQuery = historyQuery.or(
        `banned_at.lt.${historyCursor.bannedAt},and(banned_at.eq.${historyCursor.bannedAt},id.gt.${historyCursor.id})`
      )
    }

    const { data: historyBans, error: historyError } = await historyQuery
      .order('banned_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(historyLimit + 1)

    if (historyError) {
      logger.error({ error: historyError }, 'Ban history query failed')
      throw Errors.fromResponse(500, { error: historyError.message })
    }

    const historyPage = historyBans ?? []
    const historyHasMore = historyPage.length > historyLimit
    const visibleHistory = historyPage.slice(0, historyLimit)
    const lastVisibleHistory = visibleHistory.at(-1)

    return NextResponse.json({
      bans: [...activeBans, ...visibleHistory],
      activeBans,
      historyBans: visibleHistory,
      nextHistoryCursor:
        historyHasMore && lastVisibleHistory
          ? encodeHistoryCursor(lastVisibleHistory)
          : null,
      historyHasMore
    })
  }
)

/** The client sends only identifier TYPES; resolving values here stops banning someone else's identifiers. */
export const POST = withAdminGuards(
  {
    guard: 'app-admin',
    deniedMetadata: LEGACY_ADMIN_DENIED_METADATA
  },
  async (request: NextRequest, _context, { profile }) => {
    try {
      const body = await request.json()
      const { user_id, subject_types, reason, expires_at } = body

      if (typeof user_id !== 'string' || !user_id) {
        throw Errors.fromResponse(400, { error: 'user_id is required' })
      }

      let canonicalUserId: string
      try {
        canonicalUserId = canonicalizeUserBanAuthUserId(user_id)
      } catch (error) {
        if (error instanceof InvalidUserBanAuthUserIdError) {
          throw Errors.fromResponse(400, { error: error.message })
        }
        throw error
      }

      if (!Array.isArray(subject_types) || subject_types.length === 0) {
        throw Errors.fromResponse(400, {
          error: 'Select at least one identifier to ban'
        })
      }

      const requestedTypes = [...new Set(subject_types)]
      if (!requestedTypes.every(isBanSubjectType)) {
        throw Errors.fromResponse(400, {
          error: `subject_types must be any of: ${BAN_SUBJECT_TYPES.join(', ')}`
        })
      }

      if (
        profile.user_id &&
        canonicalUserId === profile.user_id.toLowerCase()
      ) {
        throw Errors.fromResponse(400, { error: 'You cannot ban yourself' })
      }

      if (typeof reason !== 'string' || !reason.trim()) {
        throw Errors.fromResponse(400, {
          error: 'A reason is required for the audit trail'
        })
      }
      if (reason.trim().length > 1000) {
        throw Errors.fromResponse(400, {
          error: 'Reason must be 1000 characters or fewer'
        })
      }

      if (expires_at !== undefined && expires_at !== null) {
        if (
          typeof expires_at !== 'string' ||
          Number.isNaN(Date.parse(expires_at))
        ) {
          throw Errors.fromResponse(400, { error: 'expires_at must be a date' })
        }
        if (Date.parse(expires_at) <= Date.now()) {
          throw Errors.fromResponse(400, {
            error: 'expires_at must be in the future'
          })
        }
      }

      const supabase = serviceDb()
      let banInsertAttempted = false
      let credentialMutationAttempted = false

      // A Discord subject may belong to another account: find owners before locking, re-check under the
      // locks, and abort on change rather than grow the lock set (lock-order deadlock risk).
      const lockUserIds = [canonicalUserId]
      if (requestedTypes.includes('discord_user_id')) {
        const [preliminaryMappingResult, preliminaryIdentityResult] =
          await Promise.all([
            supabase
              .from('player_mapping')
              .select('discord_user_id')
              .eq('user_id', canonicalUserId)
              .eq('is_current', true)
              .maybeSingle(),
            supabase.auth.admin.getUserById(canonicalUserId)
          ])

        if (preliminaryMappingResult.error) {
          logger.error(
            { error: preliminaryMappingResult.error, user_id: canonicalUserId },
            'Ban target mapping preflight failed'
          )
          throw Errors.fromResponse(500, {
            error: preliminaryMappingResult.error.message
          })
        }
        if (preliminaryIdentityResult.error) {
          logger.error(
            {
              error: preliminaryIdentityResult.error,
              user_id: canonicalUserId
            },
            'Ban target provider identity preflight failed'
          )
          throw Errors.fromResponse(500, {
            error: preliminaryIdentityResult.error.message
          })
        }

        const preliminaryProviderDiscordUserId = preliminaryIdentityResult.data
          .user
          ? (extractDiscordIdentityClaims(preliminaryIdentityResult.data.user)
              ?.discordUserId ?? null)
          : null
        const preliminaryDiscordSubjectValues = [
          preliminaryProviderDiscordUserId,
          preliminaryMappingResult.data?.discord_user_id ?? null
        ]
          .filter((value): value is string => typeof value === 'string')
          .map(normalizeBanSubjectValue)
          .filter(Boolean)

        if (preliminaryDiscordSubjectValues.length > 0) {
          const { data: preliminaryOwners, error: preliminaryOwnersError } =
            await supabase
              .from('player_mapping')
              .select('user_id')
              .in('discord_user_id', preliminaryDiscordSubjectValues)
              .eq('is_current', true)

          if (preliminaryOwnersError) {
            logger.error(
              { error: preliminaryOwnersError, user_id: canonicalUserId },
              'Ban subject owner preflight failed'
            )
            throw Errors.fromResponse(500, {
              error: preliminaryOwnersError.message
            })
          }
          for (const owner of preliminaryOwners ?? []) {
            if (typeof owner.user_id === 'string') {
              lockUserIds.push(canonicalizeUserBanAuthUserId(owner.user_id))
            }
          }
        }
      }

      return await withUserBanLocks(supabase, lockUserIds, async (leases) => {
        const assertLeasesHeld = () =>
          Promise.all(leases.map((lease) => lease.assertHeld()))

        const [mappingResult, authEmailResult, authIdentityResult] =
          await Promise.all([
            supabase
              .from('player_mapping')
              .select('discord_user_id,player_id,is_app_admin,display_name')
              .eq('user_id', canonicalUserId)
              .eq('is_current', true)
              .maybeSingle(),
            supabase
              .from('auth_user_emails')
              .select('email')
              .eq('user_id', canonicalUserId)
              .maybeSingle(),
            requestedTypes.includes('discord_user_id')
              ? supabase.auth.admin.getUserById(canonicalUserId)
              : Promise.resolve({ data: { user: null }, error: null })
          ])
        if (mappingResult.error) {
          logger.error(
            { error: mappingResult.error, user_id: canonicalUserId },
            'Ban target mapping lookup failed'
          )
          throw Errors.fromResponse(500, { error: mappingResult.error.message })
        }
        if (authEmailResult.error) {
          logger.error(
            { error: authEmailResult.error, user_id: canonicalUserId },
            'Ban target auth lookup failed'
          )
          throw Errors.fromResponse(500, {
            error: authEmailResult.error.message
          })
        }
        if (authIdentityResult.error) {
          logger.error(
            { error: authIdentityResult.error, user_id: canonicalUserId },
            'Ban target provider identity lookup failed'
          )
          throw Errors.fromResponse(500, {
            error: authIdentityResult.error.message
          })
        }
        const mapping = mappingResult.data
        const authEmail = authEmailResult.data
        const providerDiscordUserId = authIdentityResult.data.user
          ? (extractDiscordIdentityClaims(authIdentityResult.data.user)
              ?.discordUserId ?? null)
          : null

        // Banning an admin would let one admin lock out another.
        if (mapping?.is_app_admin) {
          throw Errors.fromResponse(400, {
            error: 'Remove the app admin role before banning this user'
          })
        }

        const resolved: Record<BanSubjectType, Array<string | null>> = {
          user_id: [canonicalUserId],
          email: [authEmail?.email ?? null],
          discord_user_id: [
            providerDiscordUserId,
            mapping?.discord_user_id ?? null
          ],
          player_id: [mapping?.player_id ?? null]
        }

        const subjects: Array<{ subject_type: BanSubjectType; value: string }> =
          []
        const unresolved: BanSubjectType[] = []

        for (const subject_type of requestedTypes) {
          const values = [
            ...new Set(
              resolved[subject_type]
                .filter((raw): raw is string => typeof raw === 'string')
                .map(normalizeBanSubjectValue)
                .filter(Boolean)
            )
          ]
          if (values.length === 0) {
            unresolved.push(subject_type)
            continue
          }
          subjects.push(...values.map((value) => ({ subject_type, value })))
        }

        // One advisory lock per subject; match the identity-binding order so operations cannot deadlock.
        subjects.sort(
          (left, right) =>
            BAN_SUBJECT_LOCK_ORDER[left.subject_type] -
              BAN_SUBJECT_LOCK_ORDER[right.subject_type] ||
            left.value.localeCompare(right.value)
        )

        if (subjects.length === 0) {
          throw Errors.fromResponse(400, {
            error: `This user has none of the selected identifiers on record: ${unresolved.join(', ')}`
          })
        }

        // Provider identity and a stale mapping can differ; reject if either is an app admin. Every current
        // owner must be in the preflight lock set.
        const discordSubjectValues = subjects
          .filter(({ subject_type }) => subject_type === 'discord_user_id')
          .map(({ value }) => value)
        if (discordSubjectValues.length > 0) {
          const { data: matchedOwners, error: matchedOwnersError } =
            await supabase
              .from('player_mapping')
              .select('user_id,is_app_admin')
              .in('discord_user_id', discordSubjectValues)
              .eq('is_current', true)

          if (matchedOwnersError) {
            logger.error(
              { error: matchedOwnersError, user_id: canonicalUserId },
              'Ban subject admin-owner lookup failed'
            )
            throw Errors.fromResponse(500, {
              error: matchedOwnersError.message
            })
          }
          const lockedUserIds = new Set(
            lockUserIds.map(canonicalizeUserBanAuthUserId)
          )
          if (
            (matchedOwners ?? []).some(
              ({ user_id }) =>
                typeof user_id === 'string' &&
                !lockedUserIds.has(canonicalizeUserBanAuthUserId(user_id))
            )
          ) {
            throw Errors.fromResponse(409, {
              error: 'A ban subject owner changed; refresh and retry'
            })
          }
          if ((matchedOwners ?? []).some(({ is_app_admin }) => is_app_admin)) {
            throw Errors.fromResponse(400, {
              error:
                'Remove the app admin role from every matched identity owner before banning'
            })
          }
        }

        await assertLeasesHeld()

        const ban_group_id = randomUUID()
        const nowIso = new Date().toISOString()

        // Expired rows stay open for the partial unique index until lifted_at is set.
        for (const { subject_type, value } of subjects) {
          const { error: expiryCloseError } = await supabase
            .from('user_bans')
            .update({
              lifted_at: nowIso,
              lifted_by: profile.user_id,
              lift_reason: 'Expired automatically before re-ban'
            })
            .eq('subject_type', subject_type)
            .eq('subject_value', value)
            .is('lifted_at', null)
            .lt('expires_at', nowIso)

          if (expiryCloseError) {
            logger.error(
              { error: expiryCloseError, subject_type },
              'Expired ban closeout failed'
            )
            throw Errors.fromResponse(500, { error: expiryCloseError.message })
          }
        }

        const rows = subjects.map(({ subject_type, value }) => ({
          ban_group_id,
          auth_user_id: canonicalUserId,
          subject_type,
          subject_value: value,
          reason: reason.trim(),
          banned_by: profile.user_id,
          expires_at: expires_at ?? null
        }))

        banInsertAttempted = true
        const { data, error } = await supabase
          .from('user_bans')
          .insert(rows)
          .select(BAN_SELECT)

        if (error) {
          // 23505 = already actively banned.
          if (error.code === '23505') {
            throw Errors.fromResponse(409, {
              error: 'One of these identifiers is already actively banned'
            })
          }
          logger.error({ error, user_id: canonicalUserId }, 'Ban insert failed')
          throw Errors.fromResponse(500, { error: error.message })
        }
        if (!data || data.length !== rows.length) {
          const { error: rollbackError } = await supabase
            .from('user_bans')
            .delete()
            .eq('ban_group_id', ban_group_id)
          logger.error(
            {
              expected: rows.length,
              actual: data?.length ?? 0,
              rollbackError,
              user_id: canonicalUserId,
              ban_group_id
            },
            'Ban insert returned an incomplete identifier set'
          )
          throw Errors.fromResponse(500, {
            error: 'Failed to persist the complete ban'
          })
        }
        await assertLeasesHeld()

        const effectiveNowIso = new Date().toISOString()
        const { data: effectiveBans, error: effectiveBansError } =
          await supabase
            .from('user_bans')
            .select('expires_at')
            .eq('auth_user_id', canonicalUserId)
            .is('lifted_at', null)
            .or(`expires_at.is.null,expires_at.gt.${effectiveNowIso}`)

        if (effectiveBansError) {
          logger.error(
            {
              error: effectiveBansError,
              user_id: canonicalUserId,
              ban_group_id
            },
            'Effective credential-ban lookup failed'
          )
          throw Errors.fromResponse(500, { error: effectiveBansError.message })
        }

        const banDuration = credentialBanDuration(effectiveBans ?? [])
        await assertLeasesHeld()
        credentialMutationAttempted = true
        const { error: credentialBanError } =
          await supabase.auth.admin.updateUserById(canonicalUserId, {
            ban_duration: banDuration
          })

        if (credentialBanError) {
          // Fail closed: the ledger already blocks every app auth boundary, so keep the ban.
          logger.error(
            {
              error: credentialBanError,
              user_id: canonicalUserId,
              ban_group_id
            },
            'Credential ban failed; durable application ban remains active'
          )
          throw Errors.fromResponse(500, {
            error:
              'Application access is blocked, but the login credential could not be disabled'
          })
        }
        // Also fences the response if the lease was lost.
        await assertLeasesHeld()

        logger.warn(
          {
            ban_group_id,
            target_user_id: canonicalUserId,
            subject_types: subjects.map((s) => s.subject_type),
            banned_by: profile.user_id
          },
          'User banned'
        )

        return NextResponse.json({
          success: true,
          ban_group_id,
          bans: data ?? [],
          unresolved
        })
      }).catch(async (leaseError) => {
        // The original locks have unwound, so reacquire the complete set.
        if (leaseError instanceof UserBanLockLostError && banInsertAttempted) {
          await enqueueUserBanReconciliation(supabase, {
            lockUserIds,
            adminCandidateUserIds: lockUserIds,
            credentialUserIds: credentialMutationAttempted
              ? [canonicalUserId]
              : []
          })
          await withUserBanLocksAfterLeaseLoss(
            supabase,
            lockUserIds,
            async (freshLeases) => {
              await Promise.all(
                freshLeases.map((freshLease) => freshLease.assertHeld())
              )

              // A Discord owner may have kept an admin grant from a pre-commit read; revoke it while serialized.
              const bannedUserIds = await findActivelyBannedAuthUserIds(
                lockUserIds,
                supabase
              )
              // Pre-onboarding users have no mapping and would fail the bulk RPC forever.
              const bannedAdminUserIds = await findCurrentMappedAppAdminUserIds(
                supabase,
                bannedUserIds
              )
              if (bannedAdminUserIds.length > 0) {
                const compensation = await setPlayerAppAdminBulk(
                  supabase,
                  bannedAdminUserIds,
                  false
                )
                if (
                  compensation.error ||
                  !hasExactUpdatedUsers(compensation.data, bannedAdminUserIds)
                ) {
                  throw new Error(
                    compensation.error?.message ||
                      'Ban compensation did not revoke the exact banned admin set'
                  )
                }
              }

              if (credentialMutationAttempted) {
                await compensateCredentialAfterLostLease(
                  supabase,
                  canonicalUserId
                )
              }
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
      logger.error({ error: err }, 'Ban creation exception')
      throw Errors.fromResponse(500, {
        error: err instanceof Error ? err.message : 'Internal error'
      })
    }
  }
)

import 'server-only'

import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import type { AppUser } from '@/app/types'
import type { User } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { extractDiscordIdentityClaims } from '@/app/lib/discord/identity-claims'

const logger = createComponentLogger('lib.auth.user-bans')

/** Re-registering defeats a `user_id` ban, so bans also key on durable handles. */
export const BAN_SUBJECT_TYPES = [
  'user_id',
  'email',
  'discord_user_id',
  'player_id'
] as const

export type BanSubjectType = (typeof BAN_SUBJECT_TYPES)[number]

export interface BanSubject {
  subject_type: BanSubjectType
  subject_value: string
}

export interface ActiveBan extends BanSubject {
  id: string
  ban_group_id: string
  auth_user_id: string
  reason: string | null
  banned_at: string
  expires_at: string | null
}

export function isBanSubjectType(value: unknown): value is BanSubjectType {
  return (
    typeof value === 'string' &&
    (BAN_SUBJECT_TYPES as readonly string[]).includes(value)
  )
}

/** Lowercase so case variants cannot evade lookup. */
export function normalizeBanSubjectValue(value: string): string {
  return value.trim().toLowerCase()
}

/** Includes auth id and email so pre-onboarding users are bannable. */
export function banSubjectsForUser(user: AppUser): BanSubject[] {
  const candidates: Array<[BanSubjectType, string | null | undefined]> = [
    ['user_id', user.id],
    ['email', user.email],
    ['discord_user_id', user.profile?.discord_user_id],
    ['player_id', user.profile?.player_id]
  ]

  return candidates.flatMap(([subject_type, raw]) => {
    if (typeof raw !== 'string') return []
    const subject_value = normalizeBanSubjectValue(raw)
    if (!subject_value) return []
    return [{ subject_type, subject_value }]
  })
}

/** Login-time variant: blocks replacement logins by email or linked Discord identity. */
export function banSubjectsForAuthUser(user: User): BanSubject[] {
  const discordUserId = extractDiscordIdentityClaims(user)?.discordUserId
  const candidates: Array<[BanSubjectType, string | null | undefined]> = [
    ['user_id', user.id],
    ['email', user.email],
    ['discord_user_id', discordUserId]
  ]

  return candidates.flatMap(([subject_type, raw]) => {
    if (typeof raw !== 'string') return []
    const subject_value = normalizeBanSubjectValue(raw)
    if (!subject_value) return []
    return [{ subject_type, subject_value }]
  })
}

const ACTIVE_BAN_SELECT =
  'id,ban_group_id,auth_user_id,subject_type,subject_value,reason,banned_at,expires_at'
const EFFECTIVELY_PERMANENT_BAN_SECONDS = 60 * 60 * 24 * 365 * 100

/** Longest ban wins; indefinite maps to 100 years, matching ban creation. */
export function credentialBanDuration(
  rows: ReadonlyArray<{ expires_at: string | null }>,
  nowMs = Date.now()
): string {
  let longestSeconds = 0

  for (const row of rows) {
    if (row.expires_at === null) {
      return `${EFFECTIVELY_PERMANENT_BAN_SECONDS}s`
    }
    const expiresAtMs = Date.parse(row.expires_at)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) continue
    longestSeconds = Math.max(
      longestSeconds,
      Math.ceil((expiresAtMs - nowMs) / 1000)
    )
  }

  return longestSeconds > 0 ? `${longestSeconds}s` : 'none'
}

/**
 * Service authority: `user_bans` is fail-closed, so a banned user cannot read
 * the record. Expiry is filtered here, so a lapsed ban stops applying without a sweep.
 */
async function findActiveBanForSubjects(
  subjects: BanSubject[],
  authUserId: string,
  supabase: TypedSupabaseClient = serviceDb()
): Promise<ActiveBan | null> {
  const nowIso = new Date().toISOString()

  // `auth_user_id` is immutable; check it first so changing a handle cannot evade a ban.
  const normalizedAuthUserId = normalizeBanSubjectValue(authUserId)
  if (normalizedAuthUserId) {
    const { data: authRows, error: authError } = await supabase
      .from('user_bans')
      .select(ACTIVE_BAN_SELECT)
      .eq('auth_user_id', normalizedAuthUserId)
      .is('lifted_at', null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('banned_at', { ascending: false })
      .limit(1)

    if (authError) {
      logger.error({ error: authError }, 'Immutable ban lookup failed closed')
      throw new Error('Unable to verify account access')
    }

    const authMatch = authRows?.[0]
    if (authMatch && isBanSubjectType(authMatch.subject_type)) {
      return {
        id: authMatch.id,
        ban_group_id: authMatch.ban_group_id,
        auth_user_id: authMatch.auth_user_id,
        subject_type: authMatch.subject_type,
        subject_value: authMatch.subject_value,
        reason: authMatch.reason,
        banned_at: authMatch.banned_at,
        expires_at: authMatch.expires_at
      }
    }
  }

  if (subjects.length === 0) return null

  const { data, error } = await supabase
    .from('user_bans')
    .select(ACTIVE_BAN_SELECT)
    .is('lifted_at', null)
    .in(
      'subject_value',
      subjects.map((subject) => subject.subject_value)
    )
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)

  if (error) {
    // Security boundary: an ambiguous lookup must deny, not become a ban bypass.
    logger.error({ error }, 'Ban lookup failed closed')
    throw new Error('Unable to verify account access')
  }

  // A value only bans on its own subject type.
  const matched = (data ?? []).find((row) =>
    subjects.some(
      (subject) =>
        subject.subject_type === row.subject_type &&
        subject.subject_value === row.subject_value
    )
  )

  if (!matched || !isBanSubjectType(matched.subject_type)) return null

  return {
    id: matched.id,
    ban_group_id: matched.ban_group_id,
    auth_user_id: matched.auth_user_id,
    subject_type: matched.subject_type,
    subject_value: matched.subject_value,
    reason: matched.reason,
    banned_at: matched.banned_at,
    expires_at: matched.expires_at
  }
}

export async function findActiveBanForUser(
  user: AppUser
): Promise<ActiveBan | null> {
  const supabase = serviceDb()
  const { data, error } = await supabase.auth.admin.getUserById(user.id)
  if (error || !data.user) {
    logger.error(
      { error, userId: user.id },
      'Page/API provider identity lookup failed closed'
    )
    throw new Error('Unable to verify account access')
  }

  // Resolve the Auth user so a replacement account's linked Discord identity is covered.
  return findActiveBanForAuthUser(data.user, supabase)
}

export async function findActiveBanForAuthUser(
  user: User,
  supabase: TypedSupabaseClient = serviceDb()
): Promise<ActiveBan | null> {
  const { data: mapping, error } = await supabase
    .from('player_mapping')
    .select('discord_user_id,player_id')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .maybeSingle()

  if (error) {
    logger.error(
      { error, userId: user.id },
      'Ban identity lookup failed closed'
    )
    throw new Error('Unable to verify account access')
  }

  const subjects = banSubjectsForAuthUser(user)
  const mappedCandidates: Array<[BanSubjectType, string | null | undefined]> = [
    ['discord_user_id', mapping?.discord_user_id],
    ['player_id', mapping?.player_id]
  ]

  for (const [subject_type, raw] of mappedCandidates) {
    if (typeof raw !== 'string') continue
    const subject_value = normalizeBanSubjectValue(raw)
    if (
      subject_value &&
      !subjects.some(
        (subject) =>
          subject.subject_type === subject_type &&
          subject.subject_value === subject_value
      )
    ) {
      subjects.push({ subject_type, subject_value })
    }
  }

  return findActiveBanForSubjects(subjects, user.id, supabase)
}

/** Called under the ban/lift per-user locks so no banned user can become admin concurrently. */
export async function findActivelyBannedAuthUserIds(
  userIds: readonly string[],
  supabase: TypedSupabaseClient = serviceDb()
): Promise<string[]> {
  const normalizedUserIds = [
    ...new Set(userIds.map(normalizeBanSubjectValue).filter(Boolean))
  ].sort()
  if (normalizedUserIds.length === 0) return []

  const checks = await Promise.all(
    normalizedUserIds.map(async (userId) => {
      const { data, error } = await supabase.auth.admin.getUserById(userId)
      if (error || !data.user) {
        logger.error(
          { error, userId },
          'Admin promotion identity lookup failed closed'
        )
        throw new Error('Unable to verify account access')
      }

      const ban = await findActiveBanForAuthUser(data.user, supabase)
      return ban ? userId : null
    })
  )

  return checks.filter((userId): userId is string => userId !== null).sort()
}

export async function isUserBanned(user: AppUser): Promise<boolean> {
  return (await findActiveBanForUser(user)) !== null
}

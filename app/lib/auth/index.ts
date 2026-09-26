/**
 * Public server-auth boundary. Consumers import `@/app/lib/auth`; internal
 * auth helpers stay in sibling modules and are exposed deliberately.
 */

import type { Session, User } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { db } from '@/app/lib/db'
import { serviceDb } from '@/app/lib/db'
import { cacheCompat } from '@/app/lib/utils/react-cache'
import type {
  PlayerMapping,
  TypedSupabaseClient,
  UserRole
} from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities,
  resolveVerifiedPlayers
} from '@/app/lib/auth/verified-player-authority'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { buildDiscordAvatarUrl } from '@/app/lib/discord/avatar'
import {
  findActiveBanForAuthUser,
  findActiveBanForUser
} from '@/app/lib/auth/user-bans'
const logger = createComponentLogger('lib.auth')
import type { AppUser, AuthSession, MembershipStatus } from '@/app/types'

const ROLE_FALLBACK: UserRole = 'member'

type SupabaseAuthClient = TypedSupabaseClient

// Keep aligned with the authenticated player_mapping column whitelist: never `select("*")`,
// key ciphertext or private notes just to establish membership.
const ACTIVE_PROFILE_SELECT = [
  'api_key_added_at',
  'api_key_is_valid',
  'api_key_last_verified',
  'assigned_at',
  'assigned_by',
  'assignment_notes',
  'auto_generated',
  'avatar_unit_id',
  'avatar_url',
  'boss_preferences',
  'cluster_code',
  'cluster_id',
  'created_at',
  'discord_user_id',
  'discord_username',
  'display_name',
  'guild_code',
  'has_duplicate_name',
  'id',
  'is_active',
  'is_app_admin',
  'is_current',
  'last_active_at',
  'last_battle_time',
  'last_sync_at',
  'last_sync_bombs',
  'last_sync_tokens',
  'next_bomb_seconds',
  'next_token_seconds',
  'notify_boss_kills',
  'notify_prime_kills',
  'notify_when_capped',
  'original_display_name',
  'player_id',
  'player_level',
  'player_power',
  'preferences_updated_at',
  'primary_boss',
  'primary_team',
  'protected',
  'role',
  'secondary_boss',
  'secondary_team',
  'tacticus_share_url',
  'tertiary_team',
  'theme_preference',
  'timezone',
  'updated_at',
  'user_id',
  'username'
].join(',')

type AuthErrorPayload = {
  message: string
  code?: string
}

export type AuthUser = AppUser
export type UserProfile = PlayerMapping

export interface AuthData {
  user: AuthUser
  profile: UserProfile
}

export interface SignInWithPasswordParams {
  email: string
  password: string
  rememberMe?: boolean
}

export interface SignInResult {
  user: AppUser | null
  session: AuthSession
  error: AuthErrorPayload | null
}

const ROLE_HIERARCHY: Record<NonNullable<UserRole>, number> = {
  onboarding: 0,
  applicant: 0,
  member: 1,
  Member: 1,
  officer: 2,
  Officer: 2,
  leader: 3,
  Leader: 3,
  admin: 4,
  demo: 0
}

const EMPTY_SESSION: AuthSession = {
  user: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: null
}

async function getClient(
  client?: SupabaseAuthClient
): Promise<SupabaseAuthClient> {
  if (client) {
    return client
  }

  return db()
}

interface ProfileResult {
  profile: PlayerMapping | null
  membershipStatus: MembershipStatus
}

async function verifyActiveProfile(
  serviceClient: SupabaseAuthClient,
  profile: PlayerMapping,
  userId: string
): Promise<PlayerMapping | null> {
  const verifiedPlayers = await resolveVerifiedPlayers(serviceClient, [userId])
  const witnesses = verifiedPlayers.filter(
    (row) =>
      row.mappingId === profile.id &&
      row.playerId === profile.player_id &&
      row.userId === userId &&
      row.guildCode === profile.guild_code
  )
  if (witnesses.length !== 1) {
    logger.warn(
      { userId, mappingId: profile.id },
      '[AuthService] Current mapping lacks one canonical ownership witness'
    )
    return null
  }

  const safeProfile = { ...profile }
  if (profile.discord_user_id) {
    const verifiedDiscord = await resolveVerifiedDiscordIdentities(
      serviceClient,
      [profile.discord_user_id]
    )
    const match = findVerifiedDiscordForMapping(verifiedDiscord, {
      mappingId: profile.id,
      playerId: profile.player_id,
      userId,
      guildCode: profile.guild_code,
      discordUserId: profile.discord_user_id
    })
    if (!match) {
      safeProfile.discord_user_id = null
      safeProfile.discord_username = null
    }
  }

  // avatar_url stores the Discord avatar hash; the URL is rebuilt here. Runs after the
  // attestation check so an unwitnessed linkage yields null, not an unattested identity.
  safeProfile.avatar_url = buildDiscordAvatarUrl(
    safeProfile.discord_user_id,
    safeProfile.avatar_url
  )

  return safeProfile
}

async function resolveProfile(
  supabase: SupabaseAuthClient,
  userId: string
): Promise<ProfileResult> {
  try {
    const { data: activeProfile, error: activeError } = await supabase
      .from('player_mapping')
      .select(ACTIVE_PROFILE_SELECT)
      .eq('user_id', userId)
      .eq('is_current', true)
      .maybeSingle()

    if (activeError && activeError.code !== 'PGRST116') {
      logger.warn(
        {
          userId,
          error: activeError.message
        },
        '[AuthService] Failed to fetch active player_mapping profile'
      )
    }

    if (activeProfile) {
      const verifiedProfile = await verifyActiveProfile(
        supabase,
        activeProfile as unknown as PlayerMapping,
        userId
      )
      if (!verifiedProfile) {
        return { profile: null, membershipStatus: 'none' }
      }
      return {
        profile: verifiedProfile,
        membershipStatus: 'active'
      }
    }

    const { data: inactiveProfile, error: inactiveError } = await supabase
      .from('player_mapping')
      .select(ACTIVE_PROFILE_SELECT)
      .eq('user_id', userId)
      .eq('is_current', false)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (inactiveError && inactiveError.code !== 'PGRST116') {
      logger.warn(
        {
          userId,
          error: inactiveError.message
        },
        '[AuthService] Failed to fetch inactive player_mapping profile'
      )
    }

    if (inactiveProfile) {
      // No attestation check here: an inactive membership renders chrome only.
      const inactive = inactiveProfile as unknown as PlayerMapping
      return {
        profile: {
          ...inactive,
          avatar_url: buildDiscordAvatarUrl(
            inactive.discord_user_id,
            inactive.avatar_url
          )
        },
        membershipStatus: 'inactive'
      }
    }

    return {
      profile: null,
      membershipStatus: 'none'
    }
  } catch (error) {
    logger.error(
      {
        userId,
        error
      },
      '[AuthService] Unexpected error loading profile'
    )
    return {
      profile: null,
      membershipStatus: 'none'
    }
  }
}

function inferRole(
  profile: PlayerMapping | null,
  supabaseUser: User
): UserRole {
  if (!profile) {
    return 'onboarding'
  }

  if (profile?.role) {
    return profile.role
  }

  const metadataRole = supabaseUser.user_metadata?.role as UserRole | undefined
  if (metadataRole) {
    return metadataRole
  }

  const appRole = supabaseUser.app_metadata?.role as UserRole | undefined
  if (appRole) {
    return appRole
  }

  return ROLE_FALLBACK
}

function toDisplayName(
  profile: PlayerMapping | null,
  supabaseUser: User
): string | null {
  return (
    profile?.display_name ??
    (supabaseUser.user_metadata?.display_name as string | undefined) ??
    supabaseUser.email ??
    null
  )
}

function toAvatarUrl(
  profile: PlayerMapping | null,
  supabaseUser: User
): string | null {
  return (
    profile?.avatar_url ??
    (supabaseUser.user_metadata?.avatar_url as string | undefined) ??
    null
  )
}

function mapSupabaseUser(
  supabaseUser: User,
  profile: PlayerMapping | null,
  membershipStatus: MembershipStatus
): AppUser {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? '',
    role: inferRole(profile, supabaseUser),
    displayName: toDisplayName(profile, supabaseUser),
    guildCode: profile?.guild_code ?? null,
    timezone: profile?.timezone ?? 'UTC',
    avatarUrl: toAvatarUrl(profile, supabaseUser),
    profile,
    membershipStatus
  }
}

async function buildAppUser(supabaseUser: User): Promise<AppUser> {
  const serviceClient = serviceDb()
  const { profile, membershipStatus } = await resolveProfile(
    serviceClient,
    supabaseUser.id
  )
  return mapSupabaseUser(supabaseUser, profile, membershipStatus)
}

/** getCurrentUser deduplicated per request via React cache(). */
const getCurrentUserCached = cacheCompat(async (): Promise<AppUser | null> => {
  const supabase = await db()
  try {
    const { data, error } = await supabase.auth.getUser()

    if (error) {
      logger.warn(
        {
          error: error.message
        },
        '[AuthService] Supabase getUser failed'
      )
      return null
    }

    const supabaseUser = data.user
    if (!supabaseUser) {
      return null
    }

    return buildAppUser(supabaseUser)
  } catch (error) {
    logger.error({ err: error }, '[AuthService] getCurrentUserCached threw')
    return null
  }
})

function normaliseSession(
  session: Session | null,
  user: AppUser | null
): AuthSession {
  if (!session) {
    return { ...EMPTY_SESSION, user }
  }

  return {
    user,
    accessToken: session.access_token ?? null,
    refreshToken: session.refresh_token ?? null,
    expiresAt: session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : null
  }
}

export async function getCurrentUser(
  client?: SupabaseAuthClient
): Promise<AppUser | null> {
  if (!client) {
    return getCurrentUserCached()
  }

  try {
    const { data, error } = await client.auth.getUser()

    if (error) {
      logger.warn(
        {
          error: error.message
        },
        '[AuthService] Supabase getUser failed'
      )
      return null
    }

    const supabaseUser = data.user
    if (!supabaseUser) {
      return null
    }

    return buildAppUser(supabaseUser)
  } catch (error) {
    logger.error({ err: error }, '[AuthService] getCurrentUser threw')
    return null
  }
}

export async function getSession(
  client?: SupabaseAuthClient
): Promise<AuthSession> {
  const supabase = await getClient(client)

  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      logger.warn({ error: error.message }, '[AuthService] getSession failed')
      return { ...EMPTY_SESSION }
    }

    const session = data.session
    if (!session) {
      return { ...EMPTY_SESSION }
    }

    const appUser = await buildAppUser(session.user)
    return normaliseSession(session, appUser)
  } catch (error) {
    logger.error({ err: error }, '[AuthService] getSession threw')
    return { ...EMPTY_SESSION }
  }
}

export async function signInWithPassword(
  params: SignInWithPasswordParams,
  client?: SupabaseAuthClient
): Promise<SignInResult> {
  const supabase = await getClient(client)
  const payload = {
    email: params.email.trim().toLowerCase(),
    password: params.password
  } as const
  let sessionEstablished = false

  try {
    const { data, error } = await supabase.auth.signInWithPassword(payload)

    if (error) {
      logger.warn(
        {
          errorCode: error.name
        },
        '[AuthService] signInWithPassword failed'
      )
      return {
        user: null,
        session: { ...EMPTY_SESSION },
        error: { message: error.message, code: error.name }
      }
    }

    sessionEstablished = Boolean(data.session || data.user)

    const supabaseUser = data.user ?? data.session?.user ?? null
    if (supabaseUser && (await findActiveBanForAuthUser(supabaseUser))) {
      await supabase.auth.signOut()
      logger.warn(
        { userId: supabaseUser.id },
        '[AuthService] Banned password login rejected'
      )
      return {
        user: null,
        session: { ...EMPTY_SESSION },
        error: { message: 'Account suspended', code: 'ACCOUNT_BANNED' }
      }
    }
    const appUser = supabaseUser ? await buildAppUser(supabaseUser) : null

    return {
      user: appUser,
      session: normaliseSession(data.session ?? null, appUser),
      error: null
    }
  } catch (error) {
    if (sessionEstablished) {
      try {
        await supabase.auth.signOut()
      } catch (signOutError) {
        logger.error(
          { err: signOutError },
          '[AuthService] Failed to clear rejected password-login session'
        )
      }
    }
    logger.error({ err: error }, '[AuthService] signInWithPassword threw')
    return {
      user: null,
      session: { ...EMPTY_SESSION },
      error: {
        message:
          error instanceof Error
            ? error.message
            : 'Unexpected authentication error'
      }
    }
  }
}

export async function signOut(client?: SupabaseAuthClient): Promise<void> {
  const supabase = await getClient(client)
  try {
    const { error } = await supabase.auth.signOut()
    if (error) {
      logger.warn({ error: error.message }, '[AuthService] signOut failed')
    }
  } catch (error) {
    logger.error({ err: error }, '[AuthService] signOut threw')
  }
}

export async function getAuthUser(
  client?: SupabaseAuthClient
): Promise<AuthData | null> {
  const user = await getCurrentUser(client)
  if (!user || !user.profile) {
    return null
  }

  return {
    user,
    profile: user.profile
  }
}

export async function getOptionalAuth(
  client?: SupabaseAuthClient
): Promise<AuthData | null> {
  return getAuthUser(client)
}

/** Anonymous is allowed, but an established session must still pass the ban check. */
export async function getOptionalAuthForApi(
  client?: SupabaseAuthClient
): Promise<AuthData | null> {
  const user = await getCurrentUser(client)
  if (!user) return null

  await assertNotBannedForApi(user)
  if (!user.profile) return null

  return { user, profile: user.profile }
}

/**
 * Resolves membership through the RLS-bound client. getCurrentUser() uses service authority
 * for inactive-account UX and must not authorize; this fails closed on missing rows or errors.
 */
export async function getFreshActiveMembership(
  client?: SupabaseAuthClient
): Promise<AuthData | null> {
  const supabase = await getClient(client)

  try {
    const {
      data: { user: supabaseUser },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !supabaseUser) {
      return null
    }

    const { data: profile, error: profileError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select(ACTIVE_PROFILE_SELECT)
      .eq('user_id', supabaseUser.id)
      .eq('is_current', true)
      .maybeSingle()

    if (profileError || !profile) {
      // PGRST116 from maybeSingle() means more than one is_current row, not zero: fail closed
      // and log. The exclusion constraint unique_current_user_profile already prevents this;
      // do not add a redundant unique index on the hot sync-write path.
      if (profileError) {
        const isDuplicateCurrentMembership = profileError.code === 'PGRST116'
        logger.warn(
          {
            userId: supabaseUser.id,
            error: profileError.message,
            details: profileError.details,
            duplicateCurrentMembership: isDuplicateCurrentMembership
          },
          isDuplicateCurrentMembership
            ? '[AuthService] MULTIPLE is_current player_mapping rows — failing closed (403). This is a data defect, not a permissions decision.'
            : '[AuthService] Failed fresh current-membership check'
        )
      }
      return null
    }

    const activeProfile = await verifyActiveProfile(
      serviceDb(),
      profile as unknown as PlayerMapping,
      supabaseUser.id
    )
    if (!activeProfile) {
      return null
    }
    const user = mapSupabaseUser(supabaseUser, activeProfile, 'active')

    return {
      user,
      profile: activeProfile
    }
  } catch (error) {
    logger.error(
      {
        error
      },
      '[AuthService] Fresh current-membership check threw'
    )
    return null
  }
}

export async function requireAuth(
  client?: SupabaseAuthClient
): Promise<AuthData> {
  return requireActiveMembership(client)
}

export async function requireAuthAllowInactive(
  client?: SupabaseAuthClient
): Promise<AppUser> {
  const supabase = await getClient(client)
  const user = await getCurrentUser(supabase)

  if (user) {
    await assertNotBannedForPage(user)
    return user
  }

  const { data } = await supabase.auth.getUser()
  if (data.user) {
    redirect('/onboarding')
  }

  redirect('/auth/login?reason=required')
}

export async function requireActiveMembership(
  client?: SupabaseAuthClient
): Promise<AuthData> {
  const supabase = await getClient(client)
  const authData = await getFreshActiveMembership(supabase)

  if (authData) {
    await assertNotBannedForPage(authData.user)
    return authData
  }

  const {
    data: { user: supabaseUser }
  } = await supabase.auth.getUser()

  if (!supabaseUser) {
    redirect('/auth/login?reason=required')
  }

  await assertNotBannedAuthUserForPage(supabaseUser)

  // Service authority is used only to distinguish the inactive landing-page
  // case from first-time onboarding. It never grants access.
  const { membershipStatus } = await resolveProfile(
    serviceDb(),
    supabaseUser.id
  )
  if (membershipStatus === 'inactive') {
    redirect('/home')
  }

  redirect('/onboarding')
}

export async function requireRole(
  minRole: UserRole,
  client?: SupabaseAuthClient
): Promise<AuthData> {
  const authData = await requireActiveMembership(client)
  const userRole = authData.profile.role ?? 'member'
  const userLevel = ROLE_HIERARCHY[userRole] ?? ROLE_HIERARCHY.member
  const requiredLevel = minRole
    ? (ROLE_HIERARCHY[minRole] ?? ROLE_HIERARCHY.member)
    : ROLE_HIERARCHY.member

  if (userLevel < requiredLevel) {
    redirect(`/unauthorized?required=${minRole}&current=${authData.user.role}`)
  }

  return authData
}

/**
 * Bans are enforced at the auth boundary so they apply everywhere, even before onboarding.
 * Runs only after a real session exists, so a ban reads "suspended", not "not logged in".
 */
async function assertNotBannedForPage(user: AppUser): Promise<void> {
  if (await findActiveBanForUser(user)) {
    redirect('/auth/suspended')
  }
}

async function assertNotBannedForApi(user: AppUser): Promise<void> {
  if (await findActiveBanForUser(user)) {
    throw new AuthError('Account suspended', 'ACCOUNT_BANNED')
  }
}

async function assertNotBannedAuthUserForPage(user: User): Promise<void> {
  if (await findActiveBanForAuthUser(user)) {
    redirect('/auth/suspended')
  }
}

async function assertNotBannedAuthUserForApi(user: User): Promise<void> {
  if (await findActiveBanForAuthUser(user)) {
    throw new AuthError('Account suspended', 'ACCOUNT_BANNED')
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'UNAUTHENTICATED'
      | 'ONBOARDING_REQUIRED'
      | 'INSUFFICIENT_ROLE'
      | 'ACCOUNT_BANNED',
    public readonly requiredRole?: UserRole,
    public readonly currentRole?: UserRole
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function requireAuthForApi(
  client?: SupabaseAuthClient
): Promise<AuthData> {
  const supabase = await getClient(client)
  const user = await getCurrentUser(supabase)

  if (user && user.profile) {
    await assertNotBannedForApi(user)
    return {
      user,
      profile: user.profile
    }
  }

  const { data } = await supabase.auth.getUser()
  if (data.user) {
    await assertNotBannedAuthUserForApi(data.user)
    throw new AuthError('Onboarding required', 'ONBOARDING_REQUIRED')
  }

  throw new AuthError('Authentication required', 'UNAUTHENTICATED')
}

export async function requireActiveMembershipForApi(
  client?: SupabaseAuthClient
): Promise<AuthData> {
  const supabase = await getClient(client)
  const authData = await getFreshActiveMembership(supabase)

  if (authData) {
    await assertNotBannedForApi(authData.user)
    return authData
  }

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (user) {
    await assertNotBannedAuthUserForApi(user)
    throw new AuthError(
      'Current guild membership required',
      'ONBOARDING_REQUIRED'
    )
  }

  throw new AuthError('Authentication required', 'UNAUTHENTICATED')
}

export async function requireRoleForApi(
  minRole: UserRole,
  client?: SupabaseAuthClient
): Promise<AuthData> {
  const authData = await requireActiveMembershipForApi(client)
  const userRole = authData.profile.role ?? 'member'
  const userLevel = ROLE_HIERARCHY[userRole] ?? ROLE_HIERARCHY.member
  const requiredLevel = minRole
    ? (ROLE_HIERARCHY[minRole] ?? ROLE_HIERARCHY.member)
    : ROLE_HIERARCHY.member

  if (userLevel < requiredLevel) {
    throw new AuthError(
      `Insufficient permissions. Required: ${minRole}, Current: ${userRole}`,
      'INSUFFICIENT_ROLE',
      minRole,
      userRole
    )
  }

  return authData
}

export async function refreshCurrentUser(
  client?: SupabaseAuthClient
): Promise<AppUser | null> {
  const supabase = await getClient(client)

  try {
    const {
      data: { user: supabaseUser },
      error
    } = await supabase.auth.getUser()

    if (error || !supabaseUser) {
      return null
    }

    return buildAppUser(supabaseUser)
  } catch (error) {
    logger.error({ err: error }, '[AuthService] refreshCurrentUser threw')
    return null
  }
}

export type { AppUser, AuthSession } from '@/app/types'

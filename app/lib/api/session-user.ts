import type { SupabaseClient, User } from '@supabase/supabase-js'
import type {
  PlayerMapping,
  TypedSupabaseClient
} from '@tacticus/app-core/types'
import { Errors, type AppError } from '@/app/lib/errors/AppError'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { findActiveBanForAuthUser } from '@/app/lib/auth/user-bans'

/**
 * Ban-ledger check for legacy routes that authenticate GoTrue directly (keeps
 * their error shapes). Prefer `requireSessionUser` for new code.
 */
export async function assertUnbannedAuthUser(user: User): Promise<void> {
  if (await findActiveBanForAuthUser(user)) {
    throw Errors.forbidden('Account suspended', { code: 'ACCOUNT_BANNED' })
  }
}

/** Keeps each call site's legacy 401 shape via makeError. No onboarding check (use requireAuthForApi). */
export async function requireSessionUser(
  supabase: Pick<SupabaseClient, 'auth'>,
  makeError: () => AppError = () =>
    Errors.authenticationRequired('Authentication required')
): Promise<User> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw makeError()
  await assertUnbannedAuthUser(data.user)
  return data.user
}

export type CurrentMembership = Pick<
  PlayerMapping,
  'player_id' | 'guild_code' | 'role' | 'is_app_admin'
>

/**
 * Null when unmapped OR on lookup error (treated identically). RLS client only:
 * fail-closed service-role re-verification sites must NOT use this.
 */
export async function resolveCurrentMembership(
  supabase: TypedSupabaseClient,
  userId: string
): Promise<CurrentMembership | null> {
  const { data } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('player_id, guild_code, role, is_app_admin')
    .eq('user_id', userId)
    .eq('is_current', true)
    .single()
  return data ?? null
}

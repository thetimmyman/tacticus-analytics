import type { User } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { AuthData } from '@/app/lib/auth'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { Errors } from '@/app/lib/errors/AppError'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'

export function isAppAdminProfile(
  // Pick<> so callers with a narrow player_mapping select can use it too.
  profile: Pick<AuthData['profile'], 'is_app_admin'> | null | undefined
): boolean {
  return profile?.is_app_admin === true
}

export type RequireAppAdminForApiOptions = {
  deniedMetadata?: Record<string, unknown>
}

export type RequireCurrentAppAdminForApiOptions = {
  unauthorizedMessage?: string
  unauthorizedMetadata?: Record<string, unknown>
  deniedMessage?: string
  deniedMetadata?: Record<string, unknown>
}

export async function requireAppAdminForApi(
  options: RequireAppAdminForApiOptions = {}
): Promise<AuthData> {
  const auth = await requireActiveMembershipForApi()

  if (!isAppAdminProfile(auth.profile)) {
    throw Errors.forbidden('Admin access required', options.deniedMetadata)
  }

  return auth
}

export async function requireCurrentAppAdminForApi(
  supabase: TypedSupabaseClient,
  options: RequireCurrentAppAdminForApiOptions = {}
): Promise<{ user: User }> {
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    throw Errors.unauthorized(
      options.unauthorizedMessage ?? 'Unauthorized',
      options.unauthorizedMetadata
    )
  }

  await assertUnbannedAuthUser(user)

  const { data: profile } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('is_app_admin')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (!profile?.is_app_admin) {
    throw Errors.forbidden(
      options.deniedMessage ?? 'Admin access required',
      options.deniedMetadata
    )
  }

  return { user }
}

export async function requireAppAdminUserIdForApi(): Promise<{
  user_id: string
  auth: AuthData
}> {
  const auth = await requireAppAdminForApi()

  if (!auth.profile.user_id) {
    throw Errors.forbidden('Admin profile missing user_id')
  }

  return {
    user_id: auth.profile.user_id,
    auth
  }
}

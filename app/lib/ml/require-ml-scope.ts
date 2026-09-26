import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { Errors } from '@/app/lib/errors/AppError'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

interface MlScopeProfile {
  guild_code: string | null
  cluster_code: string | null
  is_app_admin: boolean | null
}

/** Binds `/api/ml/*` guild/cluster params to the caller's membership (routes pass them to RPCs).
 * Strict: matching only `cluster` is bypassed by `?guild=<other>&cluster=<mine>`. Compare with
 * `normalizeGuildIdentifier`, never `toUpperCase()`. */
export async function requireMlScope(
  supabase: TypedSupabaseClient,
  userId: string,
  requestedGuild: string,
  requestedCluster: string | null
): Promise<void> {
  const { data } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('guild_code, cluster_code, is_app_admin')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  const profile = data as MlScopeProfile | null

  if (!profile) {
    throw Errors.forbidden('Current guild membership required')
  }

  // Admins are the intentional cross-tenant reader (building training sets).
  if (profile.is_app_admin) return

  const callerGuild = normalizeGuildIdentifier(profile.guild_code)
  if (
    !callerGuild ||
    callerGuild !== normalizeGuildIdentifier(requestedGuild)
  ) {
    throw Errors.forbidden('Access denied for this guild')
  }

  if (requestedCluster) {
    const callerCluster = normalizeGuildIdentifier(profile.cluster_code)
    if (
      !callerCluster ||
      callerCluster !== normalizeGuildIdentifier(requestedCluster)
    ) {
      throw Errors.forbidden('Access denied for this cluster')
    }
  }
}

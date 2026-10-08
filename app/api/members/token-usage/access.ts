import { db, serviceDb } from '@/app/lib/db'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'

const DEFAULT_AUTH_TIMEOUT_MS = 2000

export type TokenUsageAccessProfile = {
  /** Scopes per-player pace rows; null if unmapped. */
  player_id: string | null
  guild_code: string | null
  role: string | null
  cluster_code: string | null
}

export async function requireTokenUsageGuildAccess(
  requestedGuild: string,
  options: { authTimeoutMs?: number } = {}
) {
  const { profile, authClient } = await loadTokenUsageProfile(
    options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS
  )
  const supabase = getRuntimeProfile() === 'desktop' ? authClient : serviceDb()
  const guildConfig = await GuildConfigService.getBasic(
    supabase,
    requestedGuild
  )

  if (!guildConfig) {
    throw Errors.fromResponse(404, { error: 'Guild not found' })
  }

  const guild = guildConfig.guild_code
  const clusterCode = guildConfig.cluster_code || null
  const userRole = profile.role || 'member'
  const isOfficerOrLeader = canManageHeraldRole(userRole)
  const sameGuild =
    normalizeGuildIdentifier(profile.guild_code) ===
    normalizeGuildIdentifier(guild)
  const sameCluster =
    clusterCode && profile.cluster_code && clusterCode === profile.cluster_code
  const canReadSameCluster = sameCluster && isOfficerOrLeader

  if (
    !sameGuild &&
    clusterCode &&
    profile.cluster_code &&
    clusterCode !== profile.cluster_code
  ) {
    throw Errors.fromResponse(403, {
      error: 'Access denied - different cluster'
    })
  }

  if (!sameGuild && !canReadSameCluster) {
    throw Errors.fromResponse(403, {
      error: 'Access denied - guild mismatch'
    })
  }

  return {
    supabase,
    guildConfig,
    guild,
    clusterCode,
    profile
  }
}

async function loadTokenUsageProfile(timeoutMs: number) {
  try {
    return await Promise.race([
      loadProfile(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('auth check timed out')), timeoutMs)
      )
    ])
  } catch (error) {
    rethrowIfAppError(error)
    throw Errors.external('Authentication check failed', 503, {
      cause: error instanceof Error ? error.message : String(error)
    })
  }
}

async function loadProfile() {
  const authClient = await db()
  const user = await requireSessionUser(authClient, () =>
    Errors.fromResponse(401, { error: 'Authentication required' })
  )

  const { data: profileData, error: profileError } = await authClient
    .from('player_with_cluster')
    .select('player_id, guild_code, role, cluster_code')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (profileError || !profileData) {
    throw Errors.fromResponse(403, {
      error: 'Profile not found or access denied'
    })
  }

  const role = profileData.role || 'member'
  if (!profileData.guild_code) {
    throw Errors.fromResponse(403, { error: 'Guild association required' })
  }

  const profile: TokenUsageAccessProfile = { ...profileData, role }
  return { profile, authClient }
}

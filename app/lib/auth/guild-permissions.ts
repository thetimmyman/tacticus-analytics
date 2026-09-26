import type { db } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'
import { CLUSTER_LOOKUP_SELECT } from '@/app/lib/guild-config-selects'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import {
  canManageHeraldRole,
  isClusterLeaderRole
} from '@/app/lib/auth/role-predicates'

type SupabaseDb = Awaited<ReturnType<typeof db>>

// `display_name` lets herald dispatchers stamp the actor without re-querying.
export interface ProfileRow {
  role: string | null
  guild_code: string | null
  display_name: string | null
}

export const fetchCurrentProfile = async (
  supabase: SupabaseDb,
  userId: string,
  endpoint: string
): Promise<ProfileRow | null> => {
  const { data, error } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('role, guild_code, display_name')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  if (error) {
    throw Errors.internal('Failed to verify permissions', {
      endpoint,
      details: error.message
    })
  }
  return (data as ProfileRow | null) ?? null
}

// Current member of the target guild only. Cluster leaders are NOT admitted:
// cross-guild reads belong on the officer/cluster-leader path.
export const requireGuildMember = async (
  supabase: SupabaseDb,
  userId: string,
  targetGuildCode: string,
  endpoint: string
): Promise<void> => {
  const profile = await fetchCurrentProfile(supabase, userId, endpoint)
  if (!profile) {
    throw Errors.forbidden('No current guild membership', { endpoint })
  }
  if (profile.guild_code === targetGuildCode) return

  if (isClusterLeaderRole(profile.role) && profile.guild_code) {
    const { data: guilds } = await supabase
      .from('guild_config')
      .select(CLUSTER_LOOKUP_SELECT)
      .in('guild_code', [profile.guild_code, targetGuildCode])
    const userCluster = guilds?.find(
      (g) => g.guild_code === profile.guild_code
    )?.cluster_code
    const targetCluster = guilds?.find(
      (g) => g.guild_code === targetGuildCode
    )?.cluster_code
    if (userCluster && targetCluster && userCluster === targetCluster) return
  }

  throw Errors.forbidden('Not a member of this guild', {
    endpoint,
    guild_code: targetGuildCode
  })
}

// Officer/leader of the guild OR cluster leader of its cluster: the canonical
// write-path check for guild-scoped resources. Returns the profile row.
export const requireGuildOfficerOrClusterLeader = async (
  supabase: SupabaseDb,
  userId: string,
  targetGuildCode: string,
  endpoint: string
): Promise<ProfileRow> => {
  const profile = await fetchCurrentProfile(supabase, userId, endpoint)
  if (!profile) {
    throw Errors.forbidden('No current guild membership', { endpoint })
  }

  const isGuildOfficer =
    profile.guild_code === targetGuildCode && canManageHeraldRole(profile.role)
  if (isGuildOfficer) return profile

  if (isClusterLeaderRole(profile.role) && profile.guild_code) {
    const { data: guilds } = await supabase
      .from('guild_config')
      .select(CLUSTER_LOOKUP_SELECT)
      .in('guild_code', [profile.guild_code, targetGuildCode])
    const userCluster = guilds?.find(
      (g) => g.guild_code === profile.guild_code
    )?.cluster_code
    const targetCluster = guilds?.find(
      (g) => g.guild_code === targetGuildCode
    )?.cluster_code
    if (userCluster && targetCluster && userCluster === targetCluster)
      return profile
  }

  throw Errors.forbidden(
    'You must be an officer/leader of this guild or a cluster leader to perform this action',
    { endpoint, guild_code: targetGuildCode }
  )
}

// Credential writes use a service-role client that bypasses RLS, so this must replicate
// `guild_config_update_by_role` EXACTLY: own-guild leader/officer only, no cluster
// leaders, lowercase roles as in the policy's app_role[] array.
export const requireGuildCredentialAuthority = async (
  supabase: SupabaseDb,
  userId: string,
  canonicalGuildCode: string,
  endpoint: string
): Promise<ProfileRow> => {
  const profile = await fetchCurrentProfile(supabase, userId, endpoint)

  if (
    profile &&
    profile.guild_code === canonicalGuildCode &&
    (profile.role === 'leader' || profile.role === 'officer')
  ) {
    return profile
  }

  throw Errors.forbidden(
    'You must be a leader or officer of this guild to change its API key',
    { endpoint, guild_code: canonicalGuildCode }
  )
}

// Membership-only for UPDATING the API key: roster sync can lag, and the key
// update is what fixes it, so gating on rank would deadlock (removal stays
// officer+). Own guild only, from the attested mapping, never the request body.
export const requireGuildCredentialMember = async (
  supabase: SupabaseDb,
  userId: string,
  canonicalGuildCode: string,
  endpoint: string
): Promise<ProfileRow> => {
  const profile = await fetchCurrentProfile(supabase, userId, endpoint)

  // Without the null guard a NULL guild_code would match a null canonical code.
  if (
    profile &&
    profile.guild_code !== null &&
    profile.guild_code === canonicalGuildCode
  ) {
    return profile
  }

  throw Errors.forbidden(
    'You must be a member of this guild to update its API key',
    { endpoint, guild_code: canonicalGuildCode }
  )
}

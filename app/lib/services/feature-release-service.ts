import { serviceDb } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'
import { createComponentLogger } from '@/app/lib/logging'
import { requireAppAdminUserIdForApi } from '@/app/lib/auth/app-admin'
const logger = createComponentLogger('lib.services.feature-release-service')

export type { ReleaseStage } from '@/app/lib/utils/release-stage'

import type { ReleaseStage } from '@/app/lib/utils/release-stage'

export interface FeatureRelease {
  feature_key: string
  display_name: string
  description: string | null
  release_stage: ReleaseStage
  icon: string | null
  route: string | null
  value_proposition: string | null
  sort_order: number
}

export interface FeatureAccessResult {
  has_access: boolean
  reason: string
  stage: ReleaseStage | null
}

export interface UserAccessLevels {
  is_app_admin?: boolean
  is_admin?: boolean
  is_alpha_tester: boolean
  is_beta_tester?: boolean
  has_premium: boolean
  cluster_code: string | null
  guild_code: string | null
  max_access_level: 'alpha' | 'beta' | 'public'
}

export async function getFeatureReleaseStage(
  featureKey: string
): Promise<ReleaseStage | null> {
  try {
    const client = serviceDb()

    const { data, error } = await client
      .from('feature_releases')
      .select('release_stage')
      .eq('feature_key', featureKey)
      .single()

    if (error || !data) {
      logger.error({ error, featureKey }, 'Failed to get feature release stage')
      return null
    }

    return data.release_stage as ReleaseStage
  } catch (err) {
    logger.error(
      { error: err, featureKey },
      'Exception getting feature release stage'
    )
    return null
  }
}

export type FeatureReleaseStages = Record<string, ReleaseStage>

export async function getAllFeatureReleaseStages(): Promise<FeatureReleaseStages> {
  try {
    const client = serviceDb()

    const { data, error } = await client
      .from('feature_releases')
      .select('route, release_stage')
      .not('route', 'is', null)

    if (error || !data) {
      logger.error({ error }, 'Failed to get all feature release stages')
      return {}
    }

    const stages: FeatureReleaseStages = {}
    for (const feature of data) {
      if (feature.route) {
        stages[feature.route] = feature.release_stage as ReleaseStage
      }
    }

    return stages
  } catch (err) {
    logger.error({ error: err }, 'Exception getting all feature release stages')
    return {}
  }
}

export async function checkFeatureAccess(
  userId: string,
  featureKey: string
): Promise<FeatureAccessResult> {
  try {
    const client = serviceDb()

    const { data, error } = await client.rpc('check_feature_access', {
      p_user_id: userId,
      p_feature_key: featureKey
    })

    if (error) {
      logger.error(
        { error, userId, featureKey },
        'Failed to check feature access'
      )
      return { has_access: false, reason: 'error', stage: null }
    }

    return data as unknown as FeatureAccessResult
  } catch (err) {
    logger.error(
      { error: err, userId, featureKey },
      'Exception checking feature access'
    )
    return { has_access: false, reason: 'error', stage: null }
  }
}

export async function getUserAccessLevels(
  userId: string
): Promise<UserAccessLevels> {
  try {
    const client = serviceDb()

    const { data, error } = await client.rpc('get_user_access_levels', {
      p_user_id: userId
    })

    if (error) {
      logger.error({ error, userId }, 'Failed to get user access levels')
      return {
        is_app_admin: false,
        is_admin: false,
        is_alpha_tester: false,
        is_beta_tester: false,
        has_premium: false,
        cluster_code: null,
        guild_code: null,
        max_access_level: 'public'
      }
    }

    const levels = data as unknown as UserAccessLevels

    // The RPC may lack the cluster_code COALESCE fix; fall back to guild_config.
    if (levels.guild_code && !levels.cluster_code) {
      logger.warn(
        {
          userId,
          guild_code: levels.guild_code
        },
        'cluster_code is null despite guild_code being set, attempting guild_config fallback'
      )
      const { data: gcData } = await client
        .from('guild_config')
        .select('cluster_code')
        .eq('guild_code', levels.guild_code)
        .single()

      if (gcData?.cluster_code) {
        levels.cluster_code = gcData.cluster_code
        logger.info(
          {
            userId,
            cluster_code: gcData.cluster_code
          },
          'Resolved cluster_code from guild_config fallback'
        )
      }
    }

    return levels
  } catch (err) {
    logger.error({ error: err, userId }, 'Exception getting user access levels')
    return {
      is_app_admin: false,
      is_admin: false,
      is_alpha_tester: false,
      is_beta_tester: false,
      has_premium: false,
      cluster_code: null,
      guild_code: null,
      max_access_level: 'public'
    }
  }
}

export async function removeAlphaTester(
  userEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = serviceDb()

    const { data, error } = await client.rpc('admin_remove_alpha_tester', {
      p_user_email: userEmail
    })

    if (error) {
      logger.error({ error, userEmail }, 'Failed to remove alpha tester')
      return { success: false, error: error.message }
    }

    return data as { success: boolean; error?: string }
  } catch (err) {
    logger.error({ error: err, userEmail }, 'Exception removing alpha tester')
    return { success: false, error: 'An unexpected error occurred' }
  }
}

export type AccessLevel = 'alpha_tester' | 'beta_tester'

interface PlayerMappingRow {
  user_id: string | null
  player_id?: string | null
  display_name: string | null
  username: string | null
  guild_code: string | null
  cluster_code: string | null
  role: string | null
}

export interface EnrichedGrantUser {
  user_id: string
  email: string
  display_name: string | null
  guild_code: string | null
  cluster_code: string | null
  role: string | null
  access_level: string
  granted_at: string
  expires_at: string | null
  notes: string | null
}

export interface EnrichedAdminUser {
  user_id: string
  email: string
  display_name: string | null
  guild_code: string | null
  cluster_code: string | null
  role: string | null
  player_id: string | null
  is_app_admin: true
}

export async function requireAppAdmin(): Promise<{ user_id: string }> {
  const { user_id } = await requireAppAdminUserIdForApi()
  return { user_id }
}

async function resolveUserByEmail(email: string): Promise<{ user_id: string }> {
  const client = serviceDb()
  const { data, error } = await client
    .from('auth_user_emails')
    .select('user_id')
    .eq('email', email.toLowerCase())
    .single()

  if (error || !data?.user_id) {
    throw Errors.notFound('User', `User not found with email: ${email}`)
  }

  return { user_id: data.user_id }
}

export async function enrichUserIds(userIds: string[]): Promise<{
  emailMap: Map<string, string>
  mappingMap: Map<string, PlayerMappingRow>
  guildClusterMap: Map<string, string>
}> {
  if (userIds.length === 0) {
    return {
      emailMap: new Map(),
      mappingMap: new Map(),
      guildClusterMap: new Map()
    }
  }

  const client = serviceDb()

  const [authRes, mappingRes] = await Promise.all([
    client
      .from('auth_user_emails')
      .select('user_id, email')
      .in('user_id', userIds),
    client
      .from('player_mapping')
      .select(
        'user_id, player_id, display_name, username, guild_code, cluster_code, role'
      )
      .in('user_id', userIds)
      .eq('is_current', true)
  ])

  const emailMap = new Map(
    (authRes.data || [])
      .filter(
        (u): u is { user_id: string; email: string } =>
          u.user_id != null && u.email != null
      )
      .map((u) => [u.user_id, u.email])
  )
  const mappingMap = new Map(
    (mappingRes.data || [])
      .filter((u) => u.user_id != null)
      .map((u) => [u.user_id as string, u])
  )

  const guildCodes = [
    ...new Set(
      (mappingRes.data || [])
        .map((u: PlayerMappingRow) => u.guild_code)
        .filter((code): code is string => Boolean(code))
    )
  ]

  let guildClusterMap = new Map<string, string>()
  if (guildCodes.length > 0) {
    const { data: guildConfigs } = await client
      .from('guild_config')
      .select('guild_code, cluster_code')
      .in('guild_code', guildCodes)

    guildClusterMap = new Map(
      (guildConfigs || [])
        .filter(
          (g: {
            guild_code: string
            cluster_code: string | null
          }): g is { guild_code: string; cluster_code: string } =>
            Boolean(g.cluster_code)
        )
        .map((g) => [g.guild_code, g.cluster_code])
    )
  }

  return { emailMap, mappingMap, guildClusterMap }
}

export async function listAccessGrants(
  accessLevel: AccessLevel
): Promise<EnrichedGrantUser[]> {
  const client = serviceDb()

  const { data: grants, error } = await client
    .from('feature_access_grants')
    .select('user_id, access_level, granted_at, expires_at, notes')
    .eq('access_level', accessLevel)
    .order('granted_at', { ascending: false })

  if (error) {
    throw Errors.database(error.message)
  }

  if (!grants || grants.length === 0) {
    return []
  }

  const userIds = grants.map((g) => g.user_id)
  const { emailMap, mappingMap, guildClusterMap } = await enrichUserIds(userIds)

  return grants.map((g) => {
    const mapping = mappingMap.get(g.user_id)
    const clusterCode =
      mapping?.cluster_code ||
      (mapping?.guild_code ? guildClusterMap.get(mapping.guild_code) : null)
    return {
      user_id: g.user_id,
      email: emailMap.get(g.user_id) || 'Unknown',
      display_name: mapping?.display_name || mapping?.username || null,
      guild_code: mapping?.guild_code || null,
      cluster_code: clusterCode || null,
      role: mapping?.role || null,
      access_level: g.access_level,
      granted_at: g.granted_at,
      expires_at: g.expires_at,
      notes: g.notes
    }
  })
}

export async function listAppAdmins(): Promise<EnrichedAdminUser[]> {
  const client = serviceDb()

  const { data: admins, error } = await client
    .from('player_mapping')
    .select(
      'user_id, player_id, display_name, username, guild_code, cluster_code, role'
    )
    .eq('is_app_admin', true)
    .eq('is_current', true)

  if (error) {
    throw Errors.database(error.message)
  }

  if (!admins || admins.length === 0) {
    return []
  }

  const userIds = admins
    .map((a) => a.user_id)
    .filter((id): id is string => id !== null)

  const { emailMap, guildClusterMap } = await enrichUserIds(userIds)

  return admins
    .filter((a): a is typeof a & { user_id: string } => a.user_id !== null)
    .map((a) => {
      const clusterCode =
        a.cluster_code ||
        (a.guild_code ? guildClusterMap.get(a.guild_code) : null)
      return {
        user_id: a.user_id,
        email: emailMap.get(a.user_id) || 'Unknown',
        display_name: a.display_name || a.username || null,
        guild_code: a.guild_code || null,
        cluster_code: clusterCode || null,
        role: a.role || null,
        player_id: a.player_id,
        is_app_admin: true as const
      }
    })
}

export async function removeAccessGrant(
  email: string,
  accessLevel: AccessLevel
): Promise<{ success: boolean }> {
  if (accessLevel === 'alpha_tester') {
    const result = await removeAlphaTester(email)
    if (!result.success) {
      throw Errors.validation(result.error || 'Failed to remove alpha tester')
    }
    return { success: true }
  }

  const { user_id } = await resolveUserByEmail(email)
  const client = serviceDb()

  const { error } = await client
    .from('feature_access_grants')
    .delete()
    .eq('user_id', user_id)
    .eq('access_level', accessLevel)

  if (error) {
    throw Errors.database(error.message)
  }

  return { success: true }
}

export async function removeAppAdmin(
  email: string,
  currentUserId: string
): Promise<{ success: boolean }> {
  const { user_id } = await resolveUserByEmail(email)

  if (user_id === currentUserId) {
    throw Errors.validation('Cannot remove yourself as admin')
  }

  const client = serviceDb()

  const { data: updated, error } = await client
    .from('player_mapping')
    .update({ is_app_admin: false })
    .eq('user_id', user_id)
    .eq('is_current', true)
    .select('user_id')

  if (error) {
    throw Errors.database(error.message)
  }
  if (
    !Array.isArray(updated) ||
    updated.length !== 1 ||
    updated[0]?.user_id !== user_id
  ) {
    throw Errors.database(
      'Admin removal did not update the exact target mapping'
    )
  }

  return { success: true }
}

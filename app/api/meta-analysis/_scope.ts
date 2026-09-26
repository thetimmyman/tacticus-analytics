import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { Errors } from '@/app/lib/errors/AppError'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

export const META_ANALYSIS_PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store'
} as const

export interface MetaAnalysisAccessScope {
  ownGuildCode: string
  clusterCode: string | null
  requestedGuildCode: string | null
  primaryClusterCode: string | null
  primaryGuildCode: string | null
}

const denyScope = (): never => {
  throw Errors.forbidden('Active guild membership required')
}

/** Fresh DB check: the filter must be the caller's guild or proven in their current cluster. */
export async function resolveMetaAnalysisAccessScope(
  supabase: TypedSupabaseClient,
  userId: string,
  requestedGuildFilter: string | null
): Promise<MetaAnalysisAccessScope> {
  const { data: membership, error: membershipError } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('guild_code')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  const ownGuildCode = membership?.guild_code?.trim()
  if (membershipError || !ownGuildCode) {
    return denyScope()
  }

  const ownGuild = await GuildConfigService.getBasic(supabase, ownGuildCode)

  if (!ownGuild?.guild_code) {
    return denyScope()
  }

  const clusterCode = ownGuild.cluster_code?.trim() || null
  const requestedGuildCode = requestedGuildFilter?.trim() || null

  if (requestedGuildCode && requestedGuildCode !== ownGuildCode) {
    if (!clusterCode) {
      return denyScope()
    }

    const requestedGuild = await GuildConfigService.getBasic(
      supabase,
      requestedGuildCode
    )

    if (
      !requestedGuild?.guild_code ||
      requestedGuild.cluster_code !== clusterCode
    ) {
      return denyScope()
    }
  }

  return {
    ownGuildCode,
    clusterCode,
    requestedGuildCode,
    primaryClusterCode: requestedGuildCode ? null : clusterCode,
    primaryGuildCode: requestedGuildCode ?? (clusterCode ? null : ownGuildCode)
  }
}

export async function getAuthorizedClusterGuildCodes(
  supabase: TypedSupabaseClient,
  scope: MetaAnalysisAccessScope
): Promise<string[]> {
  if (!scope.clusterCode) return [scope.ownGuildCode]

  const { data, error } = await supabase
    .from('guild_config')
    .select('guild_code')
    .eq('cluster_code', scope.clusterCode)

  if (error || !Array.isArray(data)) {
    return denyScope()
  }

  return data
    .map((row) => row.guild_code?.trim())
    .filter((guildCode): guildCode is string => Boolean(guildCode))
}

export function withMetaAnalysisPrivateHeaders<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    const response = await handler(...args)
    response.headers.delete('CDN-Cache-Control')
    response.headers.delete('Surrogate-Control')
    response.headers.set(
      'Cache-Control',
      META_ANALYSIS_PRIVATE_HEADERS['Cache-Control']
    )
    return response
  }
}

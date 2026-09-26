import { SupabaseClient } from '@supabase/supabase-js'
import { mainCache } from '@tacticus/app-core/unified-cache'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.services.guild-config-service')

const GUILD_CONFIG_CACHE_TTL = {
  GUILD_CONFIG: 5 * 60 * 1000,
  GUILD_EXISTS: 15 * 60 * 1000,
  CLUSTER_GUILDS: 10 * 60 * 1000,
  GUILD_BASIC: 10 * 60 * 1000
}

export interface GuildConfigBasic {
  /** Canonical id and FK target, not for display; resolve user input (usually the TAG) via `findByCodeOrTag()`. */
  guild_code: string
  guild_tag: string | null
  display_name: string | null
  enabled: boolean
  cluster_code: string | null
  cluster_id: string | null
  onboarding_completed: boolean | null
}

export interface GuildConfigFull extends GuildConfigBasic {
  id: number
  guild_tag: string | null
  token_offender_threshold: number | null
  token_abuser_threshold: number | null
  primary_assignment_tokens: number | null
  secondary_assignment_tokens: number | null
  auto_sync_enabled: boolean | null
  consecutive_sync_failures: number | null
  discord_webhook_enabled: boolean | null
  api_key_is_valid: boolean | null
  api_key_last_validated: string | null
  guild_id: string | null
  onboarding_started_at: string | null
  onboarding_completed_at: string | null
  onboarding_completed: boolean | null
  tagline: string | null
  description: string | null
  logo_url: string | null
  timezone: string | null
  theme_preset: string | null
  last_successful_sync: string | null
  created_at: string
  updated_at: string
}

/** Adds service-role-only credential columns. Only the UNCACHED `getFullWithSecrets` projects them:
 * the shared cache would hand a secret-bearing row to the next caller. */
export interface GuildConfigWithSecrets extends GuildConfigFull {
  api_key_encrypted: string | null
  session_id: string | null
}

type ClusterGuildOptions = {
  includeDisabled?: boolean
  orderBy?: 'display_name' | 'guild_code'
  throwOnError?: boolean
}

function makeCacheKey(
  prefix: string,
  ...parts: (string | undefined)[]
): string {
  return `guild_config:${prefix}:${parts.filter(Boolean).join(':')}`
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizeGuildCode(guildCode: string): string {
  const trimmed = guildCode.trim()
  return UUID_PATTERN.test(trimmed)
    ? trimmed.toLowerCase()
    : trimmed.toUpperCase()
}

/** Must stay within the anon/authenticated column whitelist, or the query 42501s. */
const FULL_SELECT = `
  id,
  guild_code,
  guild_tag,
  display_name,
  enabled,
  cluster_code,
  cluster_id,
  token_offender_threshold,
  token_abuser_threshold,
  primary_assignment_tokens,
  secondary_assignment_tokens,
  auto_sync_enabled,
  consecutive_sync_failures,
  discord_webhook_enabled,
  api_key_is_valid,
  api_key_last_validated,
  guild_id,
  onboarding_started_at,
  onboarding_completed_at,
  onboarding_completed,
  tagline,
  description,
  logo_url,
  timezone,
  theme_preset,
  last_successful_sync,
  created_at,
  updated_at
`

const FULL_WITH_SECRETS_SELECT = `${FULL_SELECT.trim()},
  api_key_encrypted,
  session_id
`

export const GuildConfigService = {
  async getBasic(
    supabase: SupabaseClient,
    guildCode: string,
    options: { throwOnError?: boolean } = {}
  ): Promise<GuildConfigBasic | null> {
    const normalizedCode = normalizeGuildCode(guildCode)
    const cacheKey = makeCacheKey('basic', normalizedCode)

    try {
      const cached = await mainCache.getOrFetch(
        cacheKey,
        async () => {
          const { data, error } = await supabase
            .from('guild_config')
            .select(
              'guild_code, guild_tag, display_name, enabled, cluster_code, cluster_id, onboarding_completed'
            )
            .eq('guild_code', normalizedCode)
            .maybeSingle()

          if (error) {
            logger.warn(
              { error: error },
              'GuildConfigService.getBasic query failed:'
            )
            if (options.throwOnError) {
              throw error
            }
            return null
          }

          return data as GuildConfigBasic | null
        },
        {
          ttl: GUILD_CONFIG_CACHE_TTL.GUILD_BASIC,
          priority: 'medium',
          tags: ['guild_config', 'guild_basic', normalizedCode]
        }
      )
      return cached as GuildConfigBasic | null
    } catch (error) {
      logger.error({ err: error }, 'GuildConfigService.getBasic failed:')
      if (options.throwOnError) {
        throw error
      }
      const { data, error: fallbackError } = await supabase
        .from('guild_config')
        .select(
          'guild_code, guild_tag, display_name, enabled, cluster_code, cluster_id, onboarding_completed'
        )
        .eq('guild_code', normalizedCode)
        .maybeSingle()
      if (fallbackError && options.throwOnError) {
        throw fallbackError
      }
      return data as GuildConfigBasic | null
    }
  },

  /** Cached and safe for every client: no credential columns. */
  async getFull(
    supabase: SupabaseClient,
    guildCode: string
  ): Promise<GuildConfigFull | null> {
    const normalizedCode = normalizeGuildCode(guildCode)
    const cacheKey = makeCacheKey('full', normalizedCode)

    try {
      const cached = await mainCache.getOrFetch(
        cacheKey,
        async () => {
          const { data, error } = await supabase
            .from('guild_config')
            .select(FULL_SELECT)
            .eq('guild_code', normalizedCode)
            .maybeSingle()

          if (error) {
            logger.warn(
              { error: error },
              'GuildConfigService.getFull query failed:'
            )
            return null
          }

          return data as GuildConfigFull | null
        },
        {
          ttl: GUILD_CONFIG_CACHE_TTL.GUILD_CONFIG,
          priority: 'medium',
          tags: ['guild_config', 'guild_full', normalizedCode]
        }
      )
      return cached as GuildConfigFull | null
    } catch (error) {
      logger.error({ err: error }, 'GuildConfigService.getFull failed:')
      const { data } = await supabase
        .from('guild_config')
        .select(FULL_SELECT)
        .eq('guild_code', normalizedCode)
        .maybeSingle()
      return data as GuildConfigFull | null
    }
  },

  async getFullWithSecrets(
    serviceSupabase: SupabaseClient,
    guildCode: string
  ): Promise<GuildConfigWithSecrets | null> {
    const normalizedCode = normalizeGuildCode(guildCode)

    const { data, error } = await serviceSupabase
      .from('guild_config')
      .select(FULL_WITH_SECRETS_SELECT)
      .eq('guild_code', normalizedCode)
      .maybeSingle()

    if (error) {
      logger.warn(
        { error, guildCode: normalizedCode },
        'GuildConfigService.getFullWithSecrets query failed:'
      )
      return null
    }

    return data as GuildConfigWithSecrets | null
  },

  /** Tries guild_code (cached), guild_tag, legacy map, then guild_id; only the first is cached, so avoid on hot paths. */
  async findByCodeOrTag(
    supabase: SupabaseClient,
    input: string
  ): Promise<GuildConfigFull | null> {
    const normalized = normalizeGuildCode(input)

    const byCode = await this.getFull(supabase, normalized)
    if (byCode) {
      return byCode
    }

    const { data: byTag, error: tagErr } = await supabase
      .from('guild_config')
      .select('guild_code')
      .eq('guild_tag', normalized)
      .maybeSingle()

    if (tagErr) {
      logger.warn(
        { err: tagErr, input: normalized },
        'GuildConfigService.findByCodeOrTag tag lookup failed:'
      )
    } else if (byTag?.guild_code) {
      return this.getFull(supabase, byTag.guild_code)
    }

    const { data: byLegacy, error: legacyErr } = await supabase
      .from('guild_code_legacy_map' as 'guild_config')
      .select('canonical_guild_code')
      .eq('legacy_guild_code', normalized)
      .maybeSingle()

    if (legacyErr) {
      logger.warn(
        { err: legacyErr, input: normalized },
        'GuildConfigService.findByCodeOrTag legacy lookup failed:'
      )
    } else if (
      byLegacy &&
      typeof byLegacy === 'object' &&
      'canonical_guild_code' in byLegacy &&
      typeof byLegacy.canonical_guild_code === 'string'
    ) {
      return this.getFull(supabase, byLegacy.canonical_guild_code)
    }

    const { data: byId, error: idErr } = await supabase
      .from('guild_config')
      .select('guild_code')
      .eq('guild_id', input)
      .maybeSingle()

    if (idErr) {
      logger.warn(
        { err: idErr, input },
        'GuildConfigService.findByCodeOrTag guild_id lookup failed:'
      )
      return null
    }

    if (!byId?.guild_code) {
      return null
    }

    return this.getFull(supabase, byId.guild_code)
  },

  async exists(supabase: SupabaseClient, guildCode: string): Promise<boolean> {
    const normalizedCode = normalizeGuildCode(guildCode)
    const cacheKey = makeCacheKey('exists', normalizedCode)

    try {
      const cached = await mainCache.getOrFetch(
        cacheKey,
        async () => {
          const { count, error } = await supabase
            .from('guild_config')
            .select('guild_code', { count: 'exact', head: true })
            .eq('guild_code', normalizedCode)

          if (error) {
            logger.warn(
              { error: error },
              'GuildConfigService.exists query failed:'
            )
            return false
          }

          return (count ?? 0) > 0
        },
        {
          ttl: GUILD_CONFIG_CACHE_TTL.GUILD_EXISTS,
          priority: 'low',
          tags: ['guild_config', 'guild_exists', normalizedCode]
        }
      )
      return cached as boolean
    } catch (error) {
      logger.error({ err: error }, 'GuildConfigService.exists failed:')
      return false
    }
  },

  async isEnabled(
    supabase: SupabaseClient,
    guildCode: string
  ): Promise<boolean> {
    const config = await this.getBasic(supabase, guildCode)
    return config?.enabled === true
  },

  async getClusterGuilds(
    supabase: SupabaseClient,
    clusterCode: string,
    options: ClusterGuildOptions = {}
  ): Promise<GuildConfigBasic[]> {
    const normalizedCluster = clusterCode.trim().toUpperCase()
    const includeDisabledKey = options.includeDisabled ? 'all' : 'enabled'
    const orderColumn = options.orderBy ?? 'display_name'
    const cacheKey = makeCacheKey(
      'cluster_guilds',
      normalizedCluster,
      includeDisabledKey,
      orderColumn
    )

    try {
      const cached = await mainCache.getOrFetch(
        cacheKey,
        async () => {
          let query = supabase
            .from('guild_config')
            .select(
              'guild_code, guild_tag, display_name, enabled, cluster_code, cluster_id, onboarding_completed'
            )
            .eq('cluster_code', normalizedCluster)

          if (!options.includeDisabled) {
            query = query.eq('enabled', true)
          }

          const { data, error } = await query.order(orderColumn)

          if (error) {
            logger.warn(
              { error: error },
              'GuildConfigService.getClusterGuilds query failed:'
            )
            if (options.throwOnError) {
              throw error
            }
            return []
          }

          return (data ?? []) as GuildConfigBasic[]
        },
        {
          ttl: GUILD_CONFIG_CACHE_TTL.CLUSTER_GUILDS,
          priority: 'medium',
          tags: ['guild_config', 'cluster_guilds', normalizedCluster]
        }
      )
      return cached as GuildConfigBasic[]
    } catch (error) {
      logger.error(
        { err: error },
        'GuildConfigService.getClusterGuilds failed:'
      )
      return []
    }
  },

  invalidateGuild(guildCode: string): number {
    const normalizedCode = normalizeGuildCode(guildCode)
    return mainCache.invalidate(undefined, normalizedCode)
  },

  invalidateCluster(clusterCode: string): number {
    const normalizedCluster = clusterCode.trim().toUpperCase()
    return mainCache.invalidate(undefined, normalizedCluster)
  },

  invalidateAll(): number {
    return mainCache.invalidate(undefined, 'guild_config')
  },

  normalizeCode: normalizeGuildCode
}

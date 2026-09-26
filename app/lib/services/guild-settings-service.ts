import { db } from '@/app/lib/db'
import { serviceDb } from '@/app/lib/db'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clearGuildSettingsCache } from '@/app/lib/calculations/guild-settings'
import { clearThemeCache } from '@/app/lib/theme-system'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.services.guild-settings-service')
import {
  DEFAULT_OBFUSCATION_PERCENT,
  normalizeObfuscationPercent
} from '@tacticus/app-core/privacy'
import {
  logGuildConfigChange,
  AUDITABLE_GUILD_CONFIG_FIELDS,
  type GuildConfigSnapshot
} from '@/app/lib/audit/log-guild-config-change'
import { GUILD_SETTINGS_SELECT } from '@/app/lib/guild-config-selects'
import type {
  ExplorePrivacyMode,
  ExplorePrivacyModes
} from '@tacticus/app-core/explore-privacy'

export type GuildSettingsSocialLinks = {
  discord?: string | null
  website?: string | null
  twitter?: string | null
}

const VALID_EXPLORE_PRIVACY_MODES: ExplorePrivacyMode[] = [
  'public',
  'hide_primes',
  'hide_players',
  'obfuscate_values',
  'hide_all'
]

export interface GuildSettingsRecord {
  id: number
  guild_code: string
  guild_tag: string | null
  display_name: string
  enabled: boolean
  GR_Ranking: number | null
  GW_Ranking: number | null
  gr_ranking: number | null
  gw_ranking: number | null
  token_offender_threshold: number | null
  token_abuser_threshold: number | null
  apply_token_offender_filtering: boolean
  primary_assignment_tokens: number | null
  secondary_assignment_tokens: number | null
  discord_webhook_enabled: boolean | null
  API_Owner: string | null
  api_key_is_valid: boolean | null
  api_key_last_validated: string | null
  cluster_id: string | null
  cluster_code: string | null
  cluster_role: string | null
  tagline: string | null
  description: string | null
  logo_url: string | null
  timezone: string | null
  theme_preset: string | null
  last_successful_sync: string | null
  social_links: GuildSettingsSocialLinks | null
  explore_privacy_mode: ExplorePrivacyModes
  explore_obfuscation_percent: number
  created_at: string
  updated_at: string
  hasEncryptedApiKey: boolean
}

export interface UpdateGuildSettingsInput {
  guildCode: string
  enabled: boolean
  tokenOffenderThreshold: number
  tokenAbuserThreshold: number
  applyTokenOffenderFiltering?: boolean
  primaryAssignmentTokens: number | null
  secondaryAssignmentTokens: number | null
  tagline: string | null
  description: string | null
  logoUrl: string | null
  timezone: string | null
  themePreset: string
  previousThemePreset: string | null
  socialLinks: GuildSettingsSocialLinks
  explorePrivacyMode: ExplorePrivacyModes
  exploreObfuscationPercent: number
  actingUserId?: string | null
  requestIp?: string | null
  requestUserAgent?: string | null
}

export interface ApiKeyValidationUpdate {
  guildCode: string
  validatedAt: string
  isValid: boolean
  validatedBy: string | null
}

export interface ClusterDetails {
  cluster_code: string
  display_name: string
  description: string | null
}

type GuildSettingsClient = TypedSupabaseClient

async function ensureClient(
  client?: GuildSettingsClient
): Promise<GuildSettingsClient> {
  return client ?? (await db())
}

type AnySupabaseClient = SupabaseClient

function sanitizeSocialLinks(value: unknown): GuildSettingsSocialLinks | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const links = value as Record<string, unknown>
  return {
    discord: typeof links.discord === 'string' ? links.discord : null,
    website: typeof links.website === 'string' ? links.website : null,
    twitter: typeof links.twitter === 'string' ? links.twitter : null
  }
}

function sanitizePrivacyModes(value: unknown): ExplorePrivacyModes {
  const ensureDefault = (modes: ExplorePrivacyMode[]): ExplorePrivacyModes =>
    modes.length > 0 ? modes : ['public']

  if (Array.isArray(value)) {
    const filtered = value.filter(
      (mode): mode is ExplorePrivacyMode =>
        typeof mode === 'string' &&
        VALID_EXPLORE_PRIVACY_MODES.includes(mode as ExplorePrivacyMode)
    )
    const unique = Array.from(new Set(filtered))
    return ensureDefault(unique)
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return sanitizePrivacyModes(parsed)
      }
    } catch {
      // Not JSON: treat as a single mode string.
    }

    if (VALID_EXPLORE_PRIVACY_MODES.includes(value as ExplorePrivacyMode)) {
      return [value as ExplorePrivacyMode]
    }
  }

  return ['public']
}

function sanitizeObfuscationPercent(value: unknown): number {
  if (typeof value === 'number') {
    return normalizeObfuscationPercent(value)
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return normalizeObfuscationPercent(parsed)
    }
  }

  return DEFAULT_OBFUSCATION_PERCENT
}

function mapGuildSettingsRecord(
  record: Record<string, unknown>
): GuildSettingsRecord {
  return {
    id: record.id as number,
    guild_code: record.guild_code as string,
    guild_tag: (record.guild_tag as string | null) ?? null,
    display_name: record.display_name as string,
    enabled: Boolean(record.enabled),
    GR_Ranking: record.GR_Ranking as number | null,
    GW_Ranking: record.GW_Ranking as number | null,
    gr_ranking: record.GR_Ranking as number | null,
    gw_ranking: record.GW_Ranking as number | null,
    token_offender_threshold: record.token_offender_threshold as number | null,
    token_abuser_threshold: record.token_abuser_threshold as number | null,
    apply_token_offender_filtering: Boolean(
      record.apply_token_offender_filtering
    ),
    primary_assignment_tokens: record.primary_assignment_tokens as
      number | null,
    secondary_assignment_tokens: record.secondary_assignment_tokens as
      number | null,
    discord_webhook_enabled: record.discord_webhook_enabled as boolean | null,
    API_Owner: record.API_Owner as string | null,
    api_key_is_valid: record.api_key_is_valid as boolean | null,
    api_key_last_validated: record.api_key_last_validated as string | null,
    cluster_id: record.cluster_id as string | null,
    cluster_code: record.cluster_code as string | null,
    cluster_role: record.cluster_role as string | null,
    tagline: record.tagline as string | null,
    description: record.description as string | null,
    logo_url: record.logo_url as string | null,
    timezone: record.timezone as string | null,
    theme_preset: record.theme_preset as string | null,
    last_successful_sync: record.last_successful_sync as string | null,
    social_links: sanitizeSocialLinks(record.social_links),
    explore_privacy_mode: sanitizePrivacyModes(record.explore_privacy_mode),
    explore_obfuscation_percent: sanitizeObfuscationPercent(
      record.explore_obfuscation_percent
    ),
    created_at: record.created_at as string,
    updated_at: record.updated_at as string,
    hasEncryptedApiKey: record.api_key_is_valid != null
  }
}

async function syncExplorePrivacySnapshot(
  guildCode: string,
  privacyModes: ExplorePrivacyModes,
  obfuscationPercent: number
): Promise<void> {
  try {
    const normalized = sanitizePrivacyModes(privacyModes)
    const serialized = JSON.stringify(
      normalized.length > 0 ? normalized : ['public']
    )
    const resolvedPercent = normalizeObfuscationPercent(obfuscationPercent)

    // Service-only: request roles have no grants on public_guild_snapshots or its refresh RPC, so a
    // fallback would only mask a missing service key.
    let targetClient: TypedSupabaseClient
    try {
      targetClient = serviceDb() as TypedSupabaseClient
    } catch (serviceError) {
      logger.warn(
        {
          guildCode,
          error:
            serviceError instanceof Error
              ? serviceError.message
              : 'unknown error'
        },
        'Service client unavailable; skipping explore snapshot sync (no request-client fallback: the caller holds no write grant on public_guild_snapshots)'
      )
      return
    }

    const { data: snapshotUpdate, error } = await (
      targetClient as AnySupabaseClient
    )
      .from('public_guild_snapshots')
      .update({
        explore_privacy_mode: serialized,
        explore_obfuscation_percent: resolvedPercent
      })
      .eq('guild_code', guildCode)
      .select('guild_code')

    const updatedCount = Array.isArray(snapshotUpdate)
      ? snapshotUpdate.length
      : 0

    // A 42501 here is a real misconfiguration; do not convert it to a refresh.
    if (error) {
      logger.warn(
        { guildCode, error },
        'Failed to sync explore privacy snapshot'
      )
    } else if (updatedCount === 0) {
      const { error: refreshError } = await targetClient.rpc(
        'refresh_public_guild_snapshots'
      )
      if (refreshError) {
        logger.warn(
          { guildCode, refreshError },
          'Fallback explore snapshot refresh failed'
        )
      } else {
        logger.info(
          { guildCode, reason: 'no_rows_updated' },
          'Explore snapshot missing, triggered full refresh'
        )
      }
    }
  } catch (error) {
    logger.warn(
      { guildCode, error },
      'Unexpected error while syncing explore privacy snapshot'
    )
  }
}

export async function createDefaultGuildSettings(
  guildCode: string,
  displayName: string,
  client?: SupabaseClient
): Promise<GuildSettingsRecord> {
  // Service role: authenticated guild_config INSERTs are rejected (42501). The
  // sole caller has already run requireRole('officer') for guildCode.
  const supabase = (client ?? serviceDb()) as AnySupabaseClient

  const defaultSettings = {
    guild_code: guildCode,
    display_name: displayName,
    enabled: false,
    token_offender_threshold: 4,
    token_abuser_threshold: 5,
    primary_assignment_tokens: 3,
    secondary_assignment_tokens: 2,
    timezone: 'UTC',
    theme_preset: 'default',
    explore_privacy_mode: ['public'],
    explore_obfuscation_percent: DEFAULT_OBFUSCATION_PERCENT,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const { data, error } = await (supabase as AnySupabaseClient)
    .from('guild_config')
    .insert(defaultSettings)
    .select(GUILD_SETTINGS_SELECT)
    .single()

  if (error) {
    logger.error(
      { guildCode, error: error.message },
      'Failed to create default guild settings'
    )
    throw new Error(`Failed to create guild settings: ${error.message}`)
  }

  if (!data) {
    logger.error(
      { guildCode },
      'No data returned after creating guild settings'
    )
    throw new Error('Failed to create guild settings - no data returned')
  }

  return mapGuildSettingsRecord(data as unknown as Record<string, unknown>)
}

export async function fetchGuildSettings(
  guildCode: string,
  client?: SupabaseClient
): Promise<GuildSettingsRecord> {
  // Service role: the select includes columns withheld from authenticated
  // (42501). Callers have enforced requireRole('officer') on their own guild.
  const supabase = (client as TypedSupabaseClient) ?? serviceDb()

  const { data, error } = await (supabase as AnySupabaseClient)
    .from('guild_config')
    .select(GUILD_SETTINGS_SELECT)
    .eq('guild_code', guildCode)
    .single()

  if (error) {
    logger.error(
      { guildCode, error: error.message, code: error.code },
      'Database error fetching guild settings'
    )
    throw new Error(`Failed to fetch guild settings: ${error.message}`)
  }

  if (!data) {
    logger.error({ guildCode }, 'Guild not found in database')
    throw new Error(`Guild '${guildCode}' not found in database`)
  }

  return mapGuildSettingsRecord(data as unknown as Record<string, unknown>)
}

/** Null on any error: auditing never blocks the save. Service role, because a swallowed column
 * denial would silently disable auditing; the fields hold no secrets. */
async function fetchGuildConfigAuditSnapshot(
  guildCode: string
): Promise<GuildConfigSnapshot | null> {
  try {
    const supabase = serviceDb() as AnySupabaseClient
    const { data, error } = await supabase
      .from('guild_config')
      .select(AUDITABLE_GUILD_CONFIG_FIELDS.join(', '))
      .eq('guild_code', guildCode)
      .maybeSingle()

    if (error || !data) {
      return null
    }

    return data as unknown as GuildConfigSnapshot
  } catch {
    return null
  }
}

export async function updateGuildSettings(
  input: UpdateGuildSettingsInput,
  client?: SupabaseClient
): Promise<void> {
  const supabase = await ensureClient(client)
  const normalizedPrivacyModes = sanitizePrivacyModes(input.explorePrivacyMode)
  const normalizedObfuscationPercent = normalizeObfuscationPercent(
    input.exploreObfuscationPercent
  )

  const auditBefore = await fetchGuildConfigAuditSnapshot(input.guildCode)

  const updatePayload: Record<string, unknown> = {
    enabled: input.enabled,
    token_offender_threshold: input.tokenOffenderThreshold,
    token_abuser_threshold: input.tokenAbuserThreshold,
    primary_assignment_tokens: input.primaryAssignmentTokens,
    secondary_assignment_tokens: input.secondaryAssignmentTokens,
    tagline: input.tagline,
    description: input.description,
    logo_url: input.logoUrl,
    timezone: input.timezone,
    theme_preset: input.themePreset,
    social_links: input.socialLinks,
    explore_privacy_mode: normalizedPrivacyModes,
    explore_obfuscation_percent: normalizedObfuscationPercent,
    updated_at: new Date().toISOString()
  }

  if (input.applyTokenOffenderFiltering !== undefined) {
    updatePayload.apply_token_offender_filtering =
      input.applyTokenOffenderFiltering
  }

  const { error } = await (supabase as AnySupabaseClient)
    .from('guild_config')
    .update(updatePayload)
    .eq('guild_code', input.guildCode)

  if (error) {
    logger.error(
      { guildCode: input.guildCode, error },
      'Failed to update guild settings'
    )
    throw new Error('Failed to update guild settings')
  }

  if (auditBefore) {
    const auditAfter: GuildConfigSnapshot = {}
    for (const field of AUDITABLE_GUILD_CONFIG_FIELDS) {
      if (field in updatePayload) {
        auditAfter[field] = updatePayload[field]
      }
    }
    // Awaited (it never throws): an un-awaited write can be cut off when the server action resolves.
    await logGuildConfigChange({
      db: serviceDb() as AnySupabaseClient,
      userId: input.actingUserId ?? null,
      guildCode: input.guildCode,
      before: auditBefore,
      after: auditAfter,
      ip: input.requestIp ?? null,
      userAgent: input.requestUserAgent ?? null
    })
  }

  await clearGuildSettingsCache(input.guildCode)
  await syncExplorePrivacySnapshot(
    input.guildCode,
    normalizedPrivacyModes,
    normalizedObfuscationPercent
  )

  if (input.themePreset && input.themePreset !== input.previousThemePreset) {
    clearThemeCache(input.guildCode)
  }
}

export async function updateApiKeyValidationState(
  input: ApiKeyValidationUpdate,
  client?: SupabaseClient
): Promise<void> {
  const supabase = await ensureClient(client)

  const updatePayload = {
    api_key_is_valid: input.isValid,
    api_key_last_validated: input.validatedAt,
    API_Owner: input.validatedBy ?? undefined
  }

  const { error } = await (supabase as AnySupabaseClient)
    .from('guild_config')
    .update(updatePayload)
    .eq('guild_code', input.guildCode)

  if (error) {
    logger.error(
      { guildCode: input.guildCode, error },
      'Failed to update API key validation state'
    )
    throw new Error('Failed to update API key validation state')
  }
}

export async function fetchClusterDetails(
  clusterCode: string,
  client?: SupabaseClient
): Promise<ClusterDetails | null> {
  const supabase = await ensureClient(client)

  const { data, error } = await (supabase as AnySupabaseClient)
    .from('clusters')
    .select('*')
    .eq('cluster_code', clusterCode)
    .single()

  if (error) {
    logger.error({ clusterCode, error }, 'Failed to load cluster details')
    return null
  }

  const record = data as unknown as Record<string, unknown>

  return {
    cluster_code:
      typeof record.cluster_code === 'string'
        ? record.cluster_code
        : clusterCode,
    display_name:
      typeof record.display_name === 'string'
        ? record.display_name
        : clusterCode,
    description:
      typeof record.description === 'string' ? record.description : null
  }
}

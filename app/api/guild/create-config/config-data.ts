export interface CreateGuildOverrides {
  displayName: string
  apiOwner?: unknown
  grRanking?: unknown
  gwRanking?: unknown
  tokenOffenderThreshold?: unknown
  tokenAbuserThreshold?: unknown
  enabled?: unknown
}

export interface DiscoveredGuildData {
  guildId: string | null
  guildTag: string | null
  guildName: string | null
  memberCount: number | null
  userRole: string | null
  isLeader: boolean
}

export const numericValue = (value: unknown): number | null => {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export function buildGuildConfigData({
  guildCode,
  clusterCode,
  clusterId,
  encryptedApiKey,
  apiKeyIsValid,
  sessionId,
  discovered,
  overrides,
  now = new Date().toISOString()
}: {
  guildCode: string
  clusterCode: string
  clusterId: string | null
  encryptedApiKey: string
  apiKeyIsValid: boolean
  sessionId: string | null
  discovered: DiscoveredGuildData | null
  overrides: CreateGuildOverrides
  now?: string
}) {
  const offenderThreshold = numericValue(overrides.tokenOffenderThreshold)
  const abuserThreshold = numericValue(overrides.tokenAbuserThreshold)

  return {
    guild_code: guildCode,
    guild_tag: discovered?.guildTag || null,
    display_name: discovered?.guildName || overrides.displayName,
    guild_id: discovered?.guildId || null,
    api_key_encrypted: encryptedApiKey,
    api_key_is_valid: apiKeyIsValid,
    api_key_last_validated: now,
    api_key_migration_status: apiKeyIsValid ? 'completed' : 'pending',
    // The Add Guild form's owner wins over the discovered role.
    API_Owner:
      (typeof overrides.apiOwner === 'string' && overrides.apiOwner.trim()
        ? overrides.apiOwner.trim()
        : discovered?.userRole) || 'leader',
    enabled: typeof overrides.enabled === 'boolean' ? overrides.enabled : true,
    onboarding_completed: false,
    // False if LOKI is down at registration; guild-batch-sync re-enables it after a successful sync.
    auto_sync_enabled: apiKeyIsValid && Boolean(sessionId),
    consecutive_sync_failures: 0,
    // From the server-verified cluster row; the browser never writes these authority columns.
    is_cluster: Boolean(clusterCode),
    cluster_code: clusterCode || null,
    cluster_id: clusterId,
    onboarding_started_at: now,
    created_at: now,
    updated_at: now,
    // The shared LOKI account lives only in env; session_id is per-guild.
    session_id: sessionId,
    GR_Ranking: numericValue(overrides.grRanking),
    GW_Ranking: numericValue(overrides.gwRanking),
    onboarding_source: 'standard',
    // Only when provided so other callers keep column defaults.
    ...(offenderThreshold !== null
      ? { token_offender_threshold: offenderThreshold }
      : {}),
    ...(abuserThreshold !== null
      ? { token_abuser_threshold: abuserThreshold }
      : {})
  }
}

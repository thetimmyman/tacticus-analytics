/**
 * Must stay within the column-level SELECT whitelist for anon/authenticated
 * (no API_Owner, key, webhook URL, session_* or contact columns) or queries fail with 42501.
 */
export const PUBLIC_GUILD_CONFIG_SELECT = `
  id,
  guild_code,
  guild_tag,
  display_name,
  enabled,
  "GR_Ranking",
  "GW_Ranking",
  token_offender_threshold,
  token_abuser_threshold,
  primary_assignment_tokens,
  secondary_assignment_tokens,
  auto_sync_enabled,
  consecutive_sync_failures,
  discord_webhook_enabled,
  api_key_is_valid,
  api_key_last_validated,
  cluster_id,
  cluster_code,
  cluster_role,
  tagline,
  description,
  logo_url,
  timezone,
  theme_preset,
  last_successful_sync,
  social_links,
  explore_privacy_mode,
  explore_obfuscation_percent,
  onboarding_started_at,
  onboarding_completed_at,
  onboarding_completed,
  banner_url,
  requirements_text,
  min_power_level,
  min_account_level,
  preferred_timezone,
  preferred_languages,
  created_at,
  updated_at
`

export const GUILD_DISPLAY_SELECT = 'guild_code, display_name, guild_tag'

export const GUILD_DISPLAY_COMPACT = 'guild_code,guild_tag,display_name'

export const TOKEN_THRESHOLD_SELECT =
  'token_offender_threshold, token_abuser_threshold'

export const CLUSTER_LOOKUP_SELECT = 'guild_code, cluster_code'

/**
 * SERVICE-ROLE ONLY: includes `API_Owner`. Read with serviceDb() after
 * requireRole('officer') and an own-guild check; never with db() or dbClient().
 */
export const GUILD_SETTINGS_SELECT = `
  id,
  guild_code,
  guild_tag,
  display_name,
  enabled,
  "GR_Ranking",
  "GW_Ranking",
  token_offender_threshold,
  token_abuser_threshold,
  apply_token_offender_filtering,
  primary_assignment_tokens,
  secondary_assignment_tokens,
  discord_webhook_enabled,
  "API_Owner",
  api_key_is_valid,
  api_key_last_validated,
  cluster_id,
  cluster_code,
  cluster_role,
  tagline,
  description,
  logo_url,
  timezone,
  theme_preset,
  last_successful_sync,
  social_links,
  explore_privacy_mode,
  explore_obfuscation_percent,
  created_at,
  updated_at
`

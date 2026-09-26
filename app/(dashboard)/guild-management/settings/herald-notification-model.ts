import {
  DEFAULT_BOMB_CALCULATION_MODE,
  isBombCalculationMode,
  MIN_KNOWN_GUILD_LEVEL,
  type BombCalculationMode
} from '@/app/lib/tacticus/bomb-damage'

export interface HeraldTogglesState {
  notificationsEnabled: boolean
  mentionRolesAsText: boolean
  combinePrimeDeaths: boolean
  // Separate kill-switch so guilds can mute defeat spam and keep other pings.
  defeatAlertsEnabled: boolean
  bombAlertEnabled: boolean
  // Ping linked bomb-holders instead of the role/@everyone; falls back when none are linked.
  bombAlertPingHolders: boolean
  compactAvailabilityPosts: boolean
}

// Saved together. Empty role/URL = unset; a non-empty guildLevel overrides until the next sync.
export interface BombAlertState {
  overkillPercent: string
  roleId: string
  webhookUrl: string
  guildLevel: string
  calculationMode: BombCalculationMode
}

// Pinged when no per-boss role or mapping rule matches; empty = none.
export interface DefaultRoleState {
  roleId: string
}

export const DEFAULT_HERALD_TOGGLES: HeraldTogglesState = {
  notificationsEnabled: true,
  mentionRolesAsText: false,
  combinePrimeDeaths: false,
  defeatAlertsEnabled: true,
  bombAlertEnabled: false,
  bombAlertPingHolders: false,
  compactAvailabilityPosts: false
}

export const DEFAULT_BOMB_ALERT: BombAlertState = {
  overkillPercent: '80',
  roleId: '',
  webhookUrl: '',
  guildLevel: '',
  calculationMode: DEFAULT_BOMB_CALCULATION_MODE
}

export const DEFAULT_FALLBACK_ROLE: DefaultRoleState = { roleId: '' }

export type HeraldToggleKey = keyof HeraldTogglesState

export const HERALD_COLUMN_BY_KEY: Record<HeraldToggleKey, string> = {
  notificationsEnabled: 'notifications_enabled',
  mentionRolesAsText: 'mention_roles_as_text',
  combinePrimeDeaths: 'combine_prime_deaths',
  defeatAlertsEnabled: 'defeat_alerts_enabled',
  bombAlertEnabled: 'bomb_alert_enabled',
  bombAlertPingHolders: 'bomb_alert_ping_holders',
  compactAvailabilityPosts: 'compact_availability_posts'
}

export const HERALD_TOGGLE_LABEL: Record<HeraldToggleKey, string> = {
  notificationsEnabled: 'Send Herald messages',
  mentionRolesAsText: 'Render role mentions as plain text',
  combinePrimeDeaths: 'Combine prime defeats',
  defeatAlertsEnabled: 'Send boss-defeat alerts',
  bombAlertEnabled: 'Bomb-range alerts',
  bombAlertPingHolders: 'Bomb-range: ping bomb-holders directly',
  compactAvailabilityPosts: 'Compact availability posts (no embed)'
}

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/
const DISCORD_WEBHOOK_REGEX =
  /^https:\/\/(?:[a-z]+\.)?discord\.com\/api\/webhooks\//i

// PostgREST errors are plain objects, so an instanceof Error guard would hide DB messages.
export function describeHeraldError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

export function parseHeraldSettingsRow(row: Record<string, unknown>) {
  // Stored 0-1; rendered as integer percent.
  const rawOverkill = row.bomb_alert_overkill_threshold
  const overkill =
    typeof rawOverkill === 'number'
      ? rawOverkill
      : typeof rawOverkill === 'string'
        ? Number.parseFloat(rawOverkill)
        : 0.8
  const guildLevel = row.guild_level
  return {
    toggles: {
      notificationsEnabled: row.notifications_enabled !== false,
      mentionRolesAsText: row.mention_roles_as_text === true,
      combinePrimeDeaths: row.combine_prime_deaths === true,
      defeatAlertsEnabled: row.defeat_alerts_enabled !== false,
      bombAlertEnabled: row.bomb_alert_enabled === true,
      bombAlertPingHolders: row.bomb_alert_ping_holders === true,
      compactAvailabilityPosts: row.compact_availability_posts === true
    } satisfies HeraldTogglesState,
    bombAlert: {
      overkillPercent: Number.isFinite(overkill)
        ? String(Math.round(overkill * 100))
        : '80',
      roleId:
        typeof row.bomb_alert_role_id === 'string'
          ? row.bomb_alert_role_id
          : '',
      // The webhook URL is write-only: it loads blank and an empty save keeps the stored value.
      webhookUrl: '',
      guildLevel:
        typeof guildLevel === 'number' && Number.isFinite(guildLevel)
          ? String(guildLevel)
          : '',
      calculationMode: isBombCalculationMode(row.bomb_alert_calculation_mode)
        ? row.bomb_alert_calculation_mode
        : DEFAULT_BOMB_CALCULATION_MODE
    } satisfies BombAlertState,
    defaultRole: {
      roleId:
        typeof row.herald_default_role_id === 'string'
          ? row.herald_default_role_id
          : ''
    } satisfies DefaultRoleState
  }
}

type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; title: string; message: string }

export function validateBombAlert(
  alert: BombAlertState,
  clearWebhook: boolean,
  nowIso: string
): ValidationResult<Record<string, unknown>> {
  const overkill = Number.parseInt(alert.overkillPercent.trim(), 10)
  if (!Number.isFinite(overkill) || overkill < 50 || overkill > 100) {
    return {
      ok: false,
      title: 'Invalid overkill threshold',
      message:
        'Enter a whole number between 50 and 100. 80 means alert when 80% of bombs in hand can finish the boss.'
    }
  }
  const roleId = alert.roleId.trim()
  if (roleId && !DISCORD_SNOWFLAKE_REGEX.test(roleId)) {
    return {
      ok: false,
      title: 'Invalid role ID',
      message:
        'Discord role IDs are 17-20 digit numbers. Right-click the role in Discord → Copy Role ID (Developer Mode required).'
    }
  }
  const webhook = alert.webhookUrl.trim()
  if (webhook && !DISCORD_WEBHOOK_REGEX.test(webhook)) {
    return {
      ok: false,
      title: 'Invalid webhook URL',
      message:
        'Webhook URLs start with https://discord.com/api/webhooks/. Channel Settings → Integrations → Webhooks → Copy URL.'
    }
  }
  // Integer in [MIN_KNOWN_GUILD_LEVEL, 100]; empty clears the override.
  const guildLevelText = alert.guildLevel.trim()
  let guildLevel: number | null = null
  if (guildLevelText) {
    const parsed = Number.parseInt(guildLevelText, 10)
    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_KNOWN_GUILD_LEVEL ||
      parsed > 100
    ) {
      return {
        ok: false,
        title: 'Invalid guild level',
        message: `Enter a whole number between ${MIN_KNOWN_GUILD_LEVEL} and 100, or leave blank — Loki sync writes the live level on every sync.`
      }
    }
    guildLevel = parsed
  }

  const value: Record<string, unknown> = {
    bomb_alert_overkill_threshold: overkill / 100,
    bomb_alert_role_id: roleId || null,
    guild_level: guildLevel,
    guild_level_overridden_at: guildLevel !== null ? nowIso : null,
    bomb_alert_calculation_mode: alert.calculationMode
  }
  // Send the webhook only when replaced or cleared; null for a blank field would wipe it.
  if (webhook) value.bomb_alert_webhook_url = webhook
  else if (clearWebhook) value.bomb_alert_webhook_url = null
  return { ok: true, value }
}

export function validateDefaultHeraldRole(
  roleId: string
): ValidationResult<string | null> {
  const trimmed = roleId.trim()
  if (trimmed && !DISCORD_SNOWFLAKE_REGEX.test(trimmed)) {
    return {
      ok: false,
      title: 'Invalid role ID',
      message:
        'Discord role IDs are 17-20 digit numbers. Right-click the role in Discord → Copy Role ID (Developer Mode required), or clear the field to disable the fallback.'
    }
  }
  return { ok: true, value: trimmed || null }
}

export function isBombAlertDirty(
  current: BombAlertState,
  baseline: BombAlertState,
  clearWebhook: boolean
) {
  return (
    clearWebhook ||
    current.overkillPercent !== baseline.overkillPercent ||
    current.roleId !== baseline.roleId ||
    current.webhookUrl !== baseline.webhookUrl ||
    current.guildLevel !== baseline.guildLevel ||
    current.calculationMode !== baseline.calculationMode
  )
}

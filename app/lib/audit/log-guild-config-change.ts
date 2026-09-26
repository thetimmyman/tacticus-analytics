/**
 * Audits `guild_config` mutations (e.g. `enabled=false` drops a guild from
 * sync) as one best-effort `audit_logs` row. `audit_logs` has no INSERT policy:
 * pass a service-role client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('audit.guild-config-change')

/**
 * Audited `guild_config` fields. Secret columns are excluded so snapshots never fetch
 * secrets; audit key rotation with a boolean marker via `fields`, never the values.
 */
export const AUDITABLE_GUILD_CONFIG_FIELDS = [
  'enabled',
  'auto_sync_enabled',
  'cluster_code',
  'cluster_id',
  'api_key_is_valid',
  'discord_webhook_enabled',
  'token_offender_threshold',
  'token_abuser_threshold',
  'primary_assignment_tokens',
  'secondary_assignment_tokens',
  'theme_preset'
] as const

export type AuditableGuildConfigField =
  (typeof AUDITABLE_GUILD_CONFIG_FIELDS)[number]

export type GuildConfigSnapshot = Record<string, unknown>

export type GuildConfigFieldChange = { old: unknown; new: unknown }

export interface LogGuildConfigChangeArgs {
  /** Service-role client (`serviceDb()`): `audit_logs` has no INSERT policy for `authenticated`. */
  db: SupabaseClient
  /** Null for system/service-initiated changes. */
  userId: string | null
  guildCode: string
  before: GuildConfigSnapshot
  after: GuildConfigSnapshot
  ip?: string | null
  userAgent?: string | null
  fields?: readonly string[]
}

/** Changed auditable fields only; strict `!==` (the columns are scalars). */
export function diffGuildConfig(
  before: GuildConfigSnapshot,
  after: GuildConfigSnapshot,
  fields: readonly string[] = AUDITABLE_GUILD_CONFIG_FIELDS
): Record<string, GuildConfigFieldChange> {
  const changes: Record<string, GuildConfigFieldChange> = {}

  for (const field of fields) {
    // Fields absent from `after` were not updated, so they are not changes.
    if (!(field in after)) {
      continue
    }

    const oldValue = before[field] ?? null
    const newValue = after[field] ?? null

    if (oldValue !== newValue) {
      changes[field] = { old: oldValue, new: newValue }
    }
  }

  return changes
}

/**
 * Writes one row when an auditable field changed. Never throws, so an audit
 * failure cannot break the config save; returns whether a row was written.
 */
export async function logGuildConfigChange(
  args: LogGuildConfigChangeArgs
): Promise<boolean> {
  const { db, userId, guildCode, before, after, ip, userAgent, fields } = args

  try {
    const changes = diffGuildConfig(before, after, fields)

    if (Object.keys(changes).length === 0) {
      return false
    }

    const row: Record<string, unknown> = {
      action: 'guild_config_update',
      user_id: userId ?? null,
      details: {
        guild_code: guildCode,
        changes
      }
    }

    if (ip) {
      row.ip_address = ip
    }
    if (userAgent) {
      row.user_agent = userAgent
    }

    const { error } = await db.from('audit_logs').insert(row)

    if (error) {
      logger.error(
        {
          guildCode,
          err: error
        },
        'Failed to write guild-config audit row'
      )
      return false
    }

    return true
  } catch (error) {
    logger.error(
      {
        guildCode,
        err: error
      },
      'Unexpected guild-config audit failure'
    )
    return false
  }
}

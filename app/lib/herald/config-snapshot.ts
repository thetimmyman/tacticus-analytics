import type { db } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'

export interface GuildConfigSnapshot {
  notifications_enabled: boolean
  mention_roles_as_text: boolean
  combine_prime_deaths: boolean
  prime_threshold_a_hp: number | null
  prime_threshold_b_hp: number | null
  threshold_triggers: Record<string, unknown>
}

export interface MetaRoleMappingSnapshot {
  meta_team_slug: string
  rarity_set: string | null
  discord_role_id: string | null
  display_label: string | null
  enabled: boolean
  active_boss_ids: string[] | null
  auto_update: boolean
  prime_scope: 'main' | 'prime_a' | 'prime_b' | 'all'
  track_only: boolean
  custom_message_only: boolean
}

export interface BossConfigSnapshot {
  boss_id: string
  rarity_set: string | null
  enabled: boolean
  webhook_config_ids: string[] | null
  discord_role_ids: string[] | null
  discord_role_labels: Record<string, string>
  extra_links: unknown[] | null
  extra_videos: unknown[] | null
  custom_message_url: string | null
  notes: string | null
  side1_notes: string | null
  side2_notes: string | null
  side1_behaviour: string | null
  side2_behaviour: string | null
  side1_threshold_hp_pct: number | null
  side2_threshold_hp_pct: number | null
  ping_mode: string | null
  ping_mode_explicit: boolean | null
}

export interface HeraldConfigSnapshot {
  guild_config: GuildConfigSnapshot | null
  herald_meta_role_mapping: MetaRoleMappingSnapshot[]
  herald_boss_config: BossConfigSnapshot[]
}

export type HeraldSnapshotSelector =
  { kind: 'season'; season: number } | { kind: 'default' }

export interface HeraldConfigVersionSnapshot {
  id: number
  guild_code: string
  season: number | null
  is_default: boolean
  created_at: string
  config_snapshot: HeraldConfigSnapshot
}

export interface HeraldConfigVersionSummary {
  id: number
  guild_code: string
  season: number | null
  is_default: boolean
  created_at: string
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')

const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value)

const normalizeRoleLabels = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [id, label] of Object.entries(value)) {
    if (!/^\d{17,20}$/.test(id)) continue
    if (typeof label !== 'string') continue
    const trimmed = label.trim()
    if (trimmed.length > 0) out[id] = trimmed
  }
  return out
}

// Tolerant of missing optional fields; null only when the envelope lacks its required arrays.
export function validateSnapshot(raw: unknown): HeraldConfigSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  let guild_config: GuildConfigSnapshot | null = null
  if (obj.guild_config !== null && obj.guild_config !== undefined) {
    if (typeof obj.guild_config !== 'object') return null
    const gc = obj.guild_config as Record<string, unknown>
    if (
      typeof gc.notifications_enabled !== 'boolean' ||
      typeof gc.mention_roles_as_text !== 'boolean' ||
      typeof gc.combine_prime_deaths !== 'boolean'
    ) {
      return null
    }
    if (
      gc.prime_threshold_a_hp !== null &&
      typeof gc.prime_threshold_a_hp !== 'number'
    ) {
      return null
    }
    if (
      gc.prime_threshold_b_hp !== null &&
      typeof gc.prime_threshold_b_hp !== 'number'
    ) {
      return null
    }
    if (
      gc.threshold_triggers !== null &&
      (typeof gc.threshold_triggers !== 'object' ||
        Array.isArray(gc.threshold_triggers))
    ) {
      return null
    }
    guild_config = {
      notifications_enabled: gc.notifications_enabled,
      mention_roles_as_text: gc.mention_roles_as_text,
      combine_prime_deaths: gc.combine_prime_deaths,
      prime_threshold_a_hp: (gc.prime_threshold_a_hp as number | null) ?? null,
      prime_threshold_b_hp: (gc.prime_threshold_b_hp as number | null) ?? null,
      threshold_triggers:
        (gc.threshold_triggers as Record<string, unknown> | null) ?? {}
    }
  }

  if (!Array.isArray(obj.herald_meta_role_mapping)) return null
  if (!Array.isArray(obj.herald_boss_config)) return null

  const herald_meta_role_mapping: MetaRoleMappingSnapshot[] = []
  for (const r of obj.herald_meta_role_mapping) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    if (typeof row.meta_team_slug !== 'string') continue
    herald_meta_role_mapping.push({
      meta_team_slug: row.meta_team_slug,
      rarity_set: (row.rarity_set as string | null) ?? null,
      discord_role_id: (row.discord_role_id as string | null) ?? null,
      display_label: (row.display_label as string | null) ?? null,
      enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
      active_boss_ids: isStringArray(row.active_boss_ids)
        ? row.active_boss_ids
        : null,
      auto_update:
        typeof row.auto_update === 'boolean' ? row.auto_update : false,
      prime_scope:
        row.prime_scope === 'main' ||
        row.prime_scope === 'prime_a' ||
        row.prime_scope === 'prime_b' ||
        row.prime_scope === 'all'
          ? row.prime_scope
          : 'all',
      track_only: typeof row.track_only === 'boolean' ? row.track_only : false,
      custom_message_only:
        typeof row.custom_message_only === 'boolean'
          ? row.custom_message_only
          : false
    })
  }

  const herald_boss_config: BossConfigSnapshot[] = []
  for (const r of obj.herald_boss_config) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    if (typeof row.boss_id !== 'string') continue
    herald_boss_config.push({
      boss_id: row.boss_id,
      rarity_set: (row.rarity_set as string | null) ?? null,
      enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
      webhook_config_ids: isStringArray(row.webhook_config_ids)
        ? row.webhook_config_ids
        : null,
      discord_role_ids: isStringArray(row.discord_role_ids)
        ? row.discord_role_ids
        : null,
      discord_role_labels: normalizeRoleLabels(row.discord_role_labels),
      extra_links: isUnknownArray(row.extra_links) ? row.extra_links : null,
      extra_videos: isUnknownArray(row.extra_videos) ? row.extra_videos : null,
      custom_message_url: (row.custom_message_url as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      side1_notes: (row.side1_notes as string | null) ?? null,
      side2_notes: (row.side2_notes as string | null) ?? null,
      side1_behaviour: (row.side1_behaviour as string | null) ?? null,
      side2_behaviour: (row.side2_behaviour as string | null) ?? null,
      side1_threshold_hp_pct:
        typeof row.side1_threshold_hp_pct === 'number'
          ? row.side1_threshold_hp_pct
          : null,
      side2_threshold_hp_pct:
        typeof row.side2_threshold_hp_pct === 'number'
          ? row.side2_threshold_hp_pct
          : null,
      ping_mode: (row.ping_mode as string | null) ?? null,
      ping_mode_explicit:
        typeof row.ping_mode_explicit === 'boolean'
          ? row.ping_mode_explicit
          : null
    })
  }

  return { guild_config, herald_meta_role_mapping, herald_boss_config }
}

const guildConfigColumns =
  'notifications_enabled, mention_roles_as_text, combine_prime_deaths, prime_threshold_a_hp, prime_threshold_b_hp, threshold_triggers'
const roleMappingColumns =
  'meta_team_slug, rarity_set, discord_role_id, display_label, enabled, active_boss_ids, auto_update, prime_scope, track_only, custom_message_only'
const bossConfigColumns =
  'boss_id, rarity_set, enabled, webhook_config_ids, discord_role_ids, discord_role_labels, extra_links, extra_videos, custom_message_url, notes, side1_notes, side2_notes, side1_behaviour, side2_behaviour, side1_threshold_hp_pct, side2_threshold_hp_pct, ping_mode, ping_mode_explicit'

type SupabaseClient = Awaited<ReturnType<typeof db>>

const SEASON_PARAM_REGEX = /^\d+$/
const MIN_SEASON = 1
const MAX_SEASON = 9999

export const parseHeraldSeasonParam = (raw: string | null): number | null => {
  if (raw === null || raw === '') return null
  if (!SEASON_PARAM_REGEX.test(raw)) return null
  const n = Number.parseInt(raw, 10)
  if (n < MIN_SEASON || n > MAX_SEASON) return null
  return n
}

export const parseHeraldSnapshotSelector = (
  url: URL,
  endpoint: string
): HeraldSnapshotSelector | null => {
  const defaultParam = url.searchParams.get('default')
  const isDefault = defaultParam === '1' || defaultParam === 'true'
  if (isDefault) return { kind: 'default' }

  const seasonParam = url.searchParams.get('season')
  if (seasonParam === null) return null
  const season = parseHeraldSeasonParam(seasonParam)
  if (season === null) {
    throw Errors.validation(
      `season must be an integer between ${MIN_SEASON} and ${MAX_SEASON}`,
      { endpoint }
    )
  }
  return { kind: 'season', season }
}

export async function loadHeraldConfigVersionSnapshot(
  supabase: SupabaseClient,
  guildCode: string,
  selector: HeraldSnapshotSelector,
  endpoint: string
): Promise<HeraldConfigVersionSnapshot | null> {
  let query = supabase
    .from('herald_config_versions')
    .select('id, guild_code, season, config_snapshot, is_default, created_at')
    .eq('guild_code', guildCode)
    .limit(1)

  query =
    selector.kind === 'default'
      ? query.eq('is_default', true)
      : query.eq('season', selector.season)

  const { data, error } = await query.maybeSingle()
  if (error) {
    throw Errors.fetchFailed('Failed to load Herald config snapshot', {
      endpoint,
      details: error.message
    })
  }
  if (!data) return null

  const snapshot = validateSnapshot(
    (data as { config_snapshot?: unknown }).config_snapshot
  )
  if (!snapshot) {
    throw Errors.validation('Stored Herald config snapshot is malformed', {
      endpoint
    })
  }

  const row = data as Record<string, unknown>
  return {
    id: Number(row.id),
    guild_code: String(row.guild_code),
    season:
      typeof row.season === 'number'
        ? row.season
        : row.season === null
          ? null
          : Number(row.season),
    is_default: row.is_default === true,
    created_at: String(row.created_at),
    config_snapshot: snapshot
  }
}

export async function listHeraldConfigVersions(
  supabase: SupabaseClient,
  guildCode: string,
  endpoint: string
): Promise<HeraldConfigVersionSummary[]> {
  const { data, error } = await supabase
    .from('herald_config_versions')
    .select('id, guild_code, season, is_default, created_at')
    .eq('guild_code', guildCode)
    .order('is_default', { ascending: false })
    .order('season', { ascending: false, nullsFirst: false })

  if (error) {
    throw Errors.fetchFailed('Failed to list Herald config snapshots', {
      endpoint,
      details: error.message
    })
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    guild_code: String(row.guild_code),
    season:
      typeof row.season === 'number'
        ? row.season
        : row.season === null
          ? null
          : Number(row.season),
    is_default: row.is_default === true,
    created_at: String(row.created_at)
  }))
}

export async function assembleLiveSnapshot(
  supabase: SupabaseClient,
  guildCode: string,
  endpoint: string
): Promise<HeraldConfigSnapshot> {
  const [guildConfigRes, metaRoleRes, bossConfigRes] = await Promise.all([
    supabase
      .from('guild_config')
      .select(guildConfigColumns)
      .eq('guild_code', guildCode)
      .maybeSingle(),
    supabase
      .from('herald_meta_role_mapping')
      .select(roleMappingColumns)
      .eq('guild_code', guildCode)
      .order('meta_team_slug', { ascending: true }),
    supabase
      .from('herald_boss_config')
      .select(bossConfigColumns)
      .eq('guild_code', guildCode)
      .order('boss_id', { ascending: true })
  ])

  if (guildConfigRes.error) {
    throw Errors.fetchFailed('Failed to load guild_config for snapshot', {
      endpoint,
      details: guildConfigRes.error.message
    })
  }
  if (metaRoleRes.error) {
    throw Errors.fetchFailed(
      'Failed to load herald_meta_role_mapping for snapshot',
      { endpoint, details: metaRoleRes.error.message }
    )
  }
  if (bossConfigRes.error) {
    throw Errors.fetchFailed('Failed to load herald_boss_config for snapshot', {
      endpoint,
      details: bossConfigRes.error.message
    })
  }

  return {
    guild_config: (guildConfigRes.data as GuildConfigSnapshot | null) ?? null,
    herald_meta_role_mapping:
      (metaRoleRes.data as MetaRoleMappingSnapshot[] | null) ?? [],
    herald_boss_config:
      (bossConfigRes.data as unknown as BossConfigSnapshot[] | null) ?? []
  }
}

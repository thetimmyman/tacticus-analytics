import 'server-only'
import { createHash } from 'crypto'
import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import { createComponentLogger } from '@/app/lib/logging'
import { fetchHeraldSeedFromMetaAtlas } from './meta-atlas'
import {
  type BombCalculationMode,
  DEFAULT_BOMB_CALCULATION_MODE,
  isBombCalculationMode
} from '@/app/lib/tacticus/bomb-damage'
import {
  HERALD_WEBHOOK_TYPE,
  DISCORD_SNOWFLAKE_REGEX,
  type BossConfigExtraEntry,
  type HeraldPingMode
} from './contracts'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

const logger = createComponentLogger('herald')

export const sanitizeRoleId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return DISCORD_SNOWFLAKE_REGEX.test(trimmed) ? trimmed : null
}

export interface HeraldRoleMappingRow {
  discord_role_id: string
  active_boss_ids: string[] | null
  // NULL is catch-all; otherwise must match the transition.
  rarity_set: string | null
  meta_team_slug: string | null
  display_label: string | null
  prime_scope: 'main' | 'prime_a' | 'prime_b' | 'all'
  track_only: boolean
  custom_message_only: boolean
}

export interface ResolveRoleMappingsResult {
  mappings: HeraldRoleMappingRow[]
  droppedCount: number
}

/** Herald-internal. Per-transition filtering is in-memory. */
export const resolveHeraldRoleMappings = async (
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<ResolveRoleMappingsResult> => {
  const { data, error } = await supabase
    .from('herald_meta_role_mapping')
    .select(
      'discord_role_id, active_boss_ids, enabled, meta_team_slug, display_label, rarity_set, prime_scope, track_only, custom_message_only'
    )
    .eq('guild_code', guildCode)
    .eq('enabled', true)

  if (error || !data) {
    return { mappings: [], droppedCount: 0 }
  }

  const mappings: HeraldRoleMappingRow[] = []
  let dropped = 0
  for (const row of data) {
    const raw = row as {
      discord_role_id?: unknown
      active_boss_ids?: unknown
      meta_team_slug?: unknown
      display_label?: unknown
      rarity_set?: unknown
      prime_scope?: unknown
      track_only?: unknown
      custom_message_only?: unknown
    }
    const id = sanitizeRoleId(raw.discord_role_id)
    if (id === null) {
      dropped += 1
      continue
    }
    const activeBossIds = Array.isArray(raw.active_boss_ids)
      ? (raw.active_boss_ids as unknown[]).filter(
          (v): v is string => typeof v === 'string' && v.length > 0
        )
      : null
    const raritySet =
      typeof raw.rarity_set === 'string' && raw.rarity_set.length > 0
        ? raw.rarity_set
        : null
    const primeScope: HeraldRoleMappingRow['prime_scope'] =
      raw.prime_scope === 'main' ||
      raw.prime_scope === 'prime_a' ||
      raw.prime_scope === 'prime_b'
        ? raw.prime_scope
        : 'all'
    mappings.push({
      discord_role_id: id,
      active_boss_ids: activeBossIds,
      rarity_set: raritySet,
      meta_team_slug:
        typeof raw.meta_team_slug === 'string' ? raw.meta_team_slug : null,
      display_label:
        typeof raw.display_label === 'string' ? raw.display_label : null,
      prime_scope: primeScope,
      track_only: raw.track_only === true,
      custom_message_only: raw.custom_message_only === true
    })
  }
  return { mappings, droppedCount: dropped }
}

/** Stage-specific beats catch-all per meta-team, then scope filters, then role-id dedupe. */
export const filterRoleIdsForBoss = (
  mappings: HeraldRoleMappingRow[],
  bossId: string,
  raritySet: string | null = null,
  options?: {
    encounterIndex?: number | null
    hasCustomMessageUrl?: boolean
  }
): string[] => {
  const encounterIndex = options?.encounterIndex ?? null
  const hasCustomMessageUrl = options?.hasCustomMessageUrl === true
  const grouped = new Map<string, HeraldRoleMappingRow[]>()
  for (const m of mappings) {
    const key = m.meta_team_slug ?? `__no_slug__:${m.discord_role_id}`
    const list = grouped.get(key)
    if (list) list.push(m)
    else grouped.set(key, [m])
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const list of grouped.values()) {
    const specific = raritySet
      ? list.find((m) => m.rarity_set === raritySet)
      : null
    const fallback = list.find((m) => m.rarity_set == null) ?? null
    const chosen = specific ?? fallback
    if (!chosen) continue
    if (chosen.active_boss_ids !== null) {
      if (chosen.active_boss_ids.length === 0) continue
      if (!chosen.active_boss_ids.includes(bossId)) continue
    }
    if (chosen.track_only === true) continue
    if (chosen.custom_message_only === true && !hasCustomMessageUrl) continue
    if (encounterIndex !== null && chosen.prime_scope !== 'all') {
      const wanted: HeraldRoleMappingRow['prime_scope'] | null =
        encounterIndex === 0
          ? 'main'
          : encounterIndex === 1
            ? 'prime_a'
            : encounterIndex === 2
              ? 'prime_b'
              : null
      if (wanted === null || chosen.prime_scope !== wanted) continue
    }
    if (seen.has(chosen.discord_role_id)) continue
    seen.add(chosen.discord_role_id)
    result.push(chosen.discord_role_id)
  }
  return result
}

export interface ResolveWebhookResult {
  webhookUrl: string | null
  threadId?: string | null
  scope?: 'guild' | 'cluster'
  reason?: string
}

export const resolveHeraldWebhook = async (
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<ResolveWebhookResult> => {
  // order+limit guards against duplicate rows.
  const { data: guildRows, error: guildError } = await supabase
    .from('webhook_config')
    .select('webhook_url, thread_id, enabled, updated_at')
    .eq('guild_code', guildCode)
    .eq('webhook_type', HERALD_WEBHOOK_TYPE)
    .eq('enabled', true)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)

  if (guildError) {
    return { webhookUrl: null, reason: `db_error:${guildError.message}` }
  }
  const guildRow = guildRows?.[0]
  if (guildRow?.webhook_url && guildRow.webhook_url.trim().length > 0) {
    return {
      webhookUrl: guildRow.webhook_url,
      threadId: guildRow.thread_id ?? null,
      scope: 'guild'
    }
  }

  const guildConfig = await GuildConfigService.getBasic(supabase, guildCode)
  if (!guildConfig?.cluster_code) {
    return {
      webhookUrl: null,
      reason: guildRow ? 'empty_webhook_url' : 'no_enabled_webhook'
    }
  }

  const { data: cluster, error: clusterLookupError } = await supabase
    .from('clusters')
    .select('id')
    .eq('cluster_code', guildConfig.cluster_code)
    .maybeSingle()
  if (clusterLookupError || !cluster?.id) {
    return {
      webhookUrl: null,
      reason: guildRow ? 'empty_webhook_url' : 'no_enabled_webhook'
    }
  }

  const { data: clusterRows, error: clusterError } = await supabase
    .from('webhook_config')
    .select('webhook_url, thread_id, enabled, updated_at')
    .eq('cluster_id', cluster.id)
    .eq('webhook_type', HERALD_WEBHOOK_TYPE)
    .eq('enabled', true)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)

  if (clusterError) {
    return { webhookUrl: null, reason: `db_error:${clusterError.message}` }
  }
  const clusterRow = clusterRows?.[0]
  if (clusterRow?.webhook_url && clusterRow.webhook_url.trim().length > 0) {
    return {
      webhookUrl: clusterRow.webhook_url,
      threadId: clusterRow.thread_id ?? null,
      scope: 'cluster'
    }
  }

  return {
    webhookUrl: null,
    reason: guildRow ? 'empty_webhook_url' : 'no_enabled_webhook'
  }
}

export interface HeraldBossConfigRow {
  boss_id: string
  rarity_set: string | null
  enabled: boolean
  webhook_config_ids: string[]
  discord_role_ids: string[]
  discord_role_labels: Record<string, string>
  extra_links: BossConfigExtraEntry[]
  extra_videos: BossConfigExtraEntry[]
  custom_message_url: string | null
  notes: string | null
  side1_notes: string | null
  side2_notes: string | null
  side1_behaviour: 'skip' | 'kill' | 'threshold'
  side2_behaviour: 'skip' | 'kill' | 'threshold'
  side1_threshold_hp_pct: number | null
  side2_threshold_hp_pct: number | null
  ping_mode: HeraldPingMode
  ping_mode_explicit: boolean
}

export interface HeraldBossConfigLookup {
  resolve(bossId: string, raritySet: string | null): HeraldBossConfigRow | null
  size: number
  rows: HeraldBossConfigRow[]
}

export const normalizeExtraEntries = (
  value: unknown
): BossConfigExtraEntry[] => {
  if (!Array.isArray(value)) return []
  const out: BossConfigExtraEntry[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const url = typeof obj.url === 'string' ? obj.url.trim() : ''
    if (url.length === 0) continue
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    } catch {
      continue
    }
    const labelRaw = typeof obj.label === 'string' ? obj.label.trim() : ''
    out.push({ label: labelRaw.length > 0 ? labelRaw : url, url })
  }
  return out
}

const normalizeRoleLabels = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [id, label] of Object.entries(value)) {
    const sanitized = sanitizeRoleId(id)
    if (!sanitized || typeof label !== 'string') continue
    const trimmed = label.trim()
    if (trimmed.length > 0) out[sanitized] = trimmed
  }
  return out
}

export const resolveHeraldBossConfigs = async (
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<HeraldBossConfigLookup> => {
  const rows: HeraldBossConfigRow[] = []
  const { data, error } = await supabase
    .from('herald_boss_config')
    .select(
      'boss_id, rarity_set, enabled, webhook_config_ids, discord_role_ids, discord_role_labels, extra_links, extra_videos, custom_message_url, notes, side1_notes, side2_notes, side1_behaviour, side2_behaviour, side1_threshold_hp_pct, side2_threshold_hp_pct, ping_mode, ping_mode_explicit'
    )
    .eq('guild_code', guildCode)
  if (error || !data) {
    return { resolve: () => null, size: 0, rows: [] }
  }
  for (const row of data as Array<Record<string, unknown>>) {
    const bossId = typeof row.boss_id === 'string' ? row.boss_id : null
    if (!bossId) continue
    const raritySet =
      typeof row.rarity_set === 'string' && row.rarity_set.length > 0
        ? row.rarity_set
        : null
    rows.push({
      boss_id: bossId,
      rarity_set: raritySet,
      enabled: row.enabled !== false,
      webhook_config_ids: Array.isArray(row.webhook_config_ids)
        ? (row.webhook_config_ids as unknown[]).filter(
            (v): v is string => typeof v === 'string'
          )
        : [],
      discord_role_ids: Array.isArray(row.discord_role_ids)
        ? (row.discord_role_ids as unknown[]).filter(
            (v): v is string => typeof v === 'string'
          )
        : [],
      discord_role_labels: normalizeRoleLabels(row.discord_role_labels),
      extra_links: normalizeExtraEntries(row.extra_links),
      extra_videos: normalizeExtraEntries(row.extra_videos),
      custom_message_url:
        typeof row.custom_message_url === 'string' &&
        row.custom_message_url.trim().length > 0
          ? row.custom_message_url.trim()
          : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      side1_notes: typeof row.side1_notes === 'string' ? row.side1_notes : null,
      side2_notes: typeof row.side2_notes === 'string' ? row.side2_notes : null,
      side1_behaviour:
        row.side1_behaviour === 'skip' || row.side1_behaviour === 'threshold'
          ? row.side1_behaviour
          : 'kill',
      side2_behaviour:
        row.side2_behaviour === 'skip' || row.side2_behaviour === 'threshold'
          ? row.side2_behaviour
          : 'kill',
      side1_threshold_hp_pct:
        typeof row.side1_threshold_hp_pct === 'number'
          ? row.side1_threshold_hp_pct
          : null,
      side2_threshold_hp_pct:
        typeof row.side2_threshold_hp_pct === 'number'
          ? row.side2_threshold_hp_pct
          : null,
      ping_mode:
        row.ping_mode === 'combined' || row.ping_mode === 'skip_all'
          ? row.ping_mode
          : 'per_side',
      ping_mode_explicit: row.ping_mode_explicit === true
    })
  }

  const specificByKey = new Map<string, HeraldBossConfigRow>()
  const fallbackByBoss = new Map<string, HeraldBossConfigRow>()
  for (const row of rows) {
    if (row.rarity_set !== null) {
      specificByKey.set(`${row.boss_id}|${row.rarity_set}`, row)
    } else {
      fallbackByBoss.set(row.boss_id, row)
    }
  }

  const resolve = (
    bossId: string,
    raritySet: string | null
  ): HeraldBossConfigRow | null => {
    if (raritySet) {
      const specific = specificByKey.get(`${bossId}|${raritySet}`)
      if (specific) return specific
    }
    return fallbackByBoss.get(bossId) ?? null
  }

  return { resolve, size: rows.length, rows }
}

export interface HeraldChannel {
  webhookId: string | null
  webhookUrl: string
  threadId: string | null
}

export const resolveChannelsForTransition = async (
  supabase: ServiceSupabaseClient,
  guildCode: string,
  bossConfig: HeraldBossConfigRow | null,
  guildDefaultUrl: string | null,
  guildDefaultThreadId: string | null
): Promise<HeraldChannel[]> => {
  if (bossConfig && !bossConfig.enabled) return []

  const ids = bossConfig?.webhook_config_ids ?? []
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('webhook_config')
      .select('id, webhook_url, thread_id, enabled')
      .in('id', ids)
      .eq('enabled', true)
    if (error || !data) {
      // Fall back to the guild default so a DB hiccup doesn't drop the event.
      logger.warn(
        {
          guild_code: guildCode,
          ids_count: ids.length,
          error: error?.message ?? 'unknown'
        },
        'herald.channels.lookup_error'
      )
    } else {
      const channels: HeraldChannel[] = []
      for (const row of data) {
        if (!row.webhook_url || row.webhook_url.trim().length === 0) continue
        channels.push({
          webhookId: row.id,
          webhookUrl: row.webhook_url,
          threadId: row.thread_id ?? null
        })
      }
      if (channels.length > 0) return channels
      logger.warn(
        {
          guild_code: guildCode,
          requested: ids.length
        },
        'herald.channels.all_invalid'
      )
    }
  }

  if (guildDefaultUrl) {
    return [
      {
        webhookId: null,
        webhookUrl: guildDefaultUrl,
        threadId: guildDefaultThreadId
      }
    ]
  }
  return []
}

/** Non-empty per-boss role IDs override guild mappings. */
export const resolveRoleIdsForTransition = (
  bossConfig: HeraldBossConfigRow | null,
  guildMappings: HeraldRoleMappingRow[],
  bossId: string,
  raritySet: string | null = null,
  options?: {
    encounterIndex?: number | null
    hasCustomMessageUrl?: boolean
  }
): string[] => {
  if (bossConfig && bossConfig.discord_role_ids.length > 0) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of bossConfig.discord_role_ids) {
      const id = sanitizeRoleId(raw)
      if (id === null || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }
  return filterRoleIdsForBoss(guildMappings, bossId, raritySet, options)
}

export const pingedMetaTeamNamesForBoss = (
  mappings: HeraldRoleMappingRow[],
  bossId: string,
  raritySet: string | null,
  pingedRoleIds: string[]
): string[] => {
  if (pingedRoleIds.length === 0) return []
  const pingedRoleSet = new Set(pingedRoleIds)
  // Must match filterRoleIdsForBoss precedence.
  const groups = new Map<string, HeraldRoleMappingRow[]>()
  for (const m of mappings) {
    if (!m.discord_role_id) continue
    const slug = m.meta_team_slug
    if (!slug) continue
    const list = groups.get(slug) ?? []
    list.push(m)
    groups.set(slug, list)
  }
  const out: string[] = []
  for (const [slug, list] of groups) {
    const specific = list.find((m) => m.rarity_set === raritySet) ?? null
    const fallback = list.find((m) => m.rarity_set == null) ?? null
    const chosen = specific ?? fallback
    if (!chosen || !chosen.discord_role_id) continue
    if (!pingedRoleSet.has(chosen.discord_role_id)) continue
    const scope = chosen.active_boss_ids
    if (Array.isArray(scope) && scope.length > 0 && !scope.includes(bossId))
      continue
    out.push(slug.trim().toLowerCase())
  }
  return out
}

// A failed load returns the column defaults: a read error must not silence dispatch.
export interface GuildHeraldConfig {
  notificationsEnabled: boolean
  mentionRolesAsText: boolean
  combinePrimeDeaths: boolean
  // Silences defeat posts only; detection still runs for the rotation predictor.
  defeatAlertsEnabled: boolean
  bombAlertEnabled: boolean
  bombAlertOverkillThreshold: number
  bombAlertRoleId: string | null
  bombAlertWebhookUrl: string | null
  guildLevel: number | null
  bombAlertCalculationMode: BombCalculationMode
  bombAlertPingHolders: boolean
  compactAvailabilityPosts: boolean
  // Validated as a snowflake before use.
  defaultRoleId: string | null
  clusterCode: string | null
}

export const DEFAULT_GUILD_HERALD_CONFIG: GuildHeraldConfig = {
  notificationsEnabled: true,
  mentionRolesAsText: false,
  combinePrimeDeaths: false,
  defeatAlertsEnabled: true,
  bombAlertEnabled: false,
  bombAlertOverkillThreshold: 0.8,
  bombAlertRoleId: null,
  bombAlertWebhookUrl: null,
  guildLevel: null,
  bombAlertCalculationMode: DEFAULT_BOMB_CALCULATION_MODE,
  bombAlertPingHolders: false,
  compactAvailabilityPosts: false,
  defaultRoleId: null,
  clusterCode: null
}

export const loadGuildHeraldConfig = async (
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<GuildHeraldConfig> => {
  try {
    const { data, error } = await supabase
      .from('guild_config')
      .select(
        'notifications_enabled, mention_roles_as_text, combine_prime_deaths, defeat_alerts_enabled, bomb_alert_enabled, bomb_alert_overkill_threshold, bomb_alert_role_id, bomb_alert_webhook_url, guild_level, bomb_alert_calculation_mode, bomb_alert_ping_holders, compact_availability_posts, herald_default_role_id, cluster_code'
      )
      .eq('guild_code', guildCode)
      .maybeSingle()
    if (error || !data) return { ...DEFAULT_GUILD_HERALD_CONFIG }
    const row = data as unknown as Record<string, unknown>
    const overkillRaw = row.bomb_alert_overkill_threshold
    const overkill =
      typeof overkillRaw === 'number'
        ? overkillRaw
        : typeof overkillRaw === 'string'
          ? Number.parseFloat(overkillRaw)
          : NaN
    const guildLevelRaw = row.guild_level
    const guildLevel =
      typeof guildLevelRaw === 'number' && Number.isFinite(guildLevelRaw)
        ? guildLevelRaw
        : null
    const modeRaw = row.bomb_alert_calculation_mode
    return {
      notificationsEnabled: row.notifications_enabled !== false,
      mentionRolesAsText: row.mention_roles_as_text === true,
      combinePrimeDeaths: row.combine_prime_deaths === true,
      defeatAlertsEnabled: row.defeat_alerts_enabled !== false,
      bombAlertEnabled: row.bomb_alert_enabled === true,
      bombAlertOverkillThreshold:
        Number.isFinite(overkill) && overkill > 0 && overkill <= 1
          ? overkill
          : 0.8,
      bombAlertRoleId:
        typeof row.bomb_alert_role_id === 'string' &&
        DISCORD_SNOWFLAKE_REGEX.test(row.bomb_alert_role_id)
          ? row.bomb_alert_role_id
          : null,
      bombAlertWebhookUrl:
        typeof row.bomb_alert_webhook_url === 'string' &&
        row.bomb_alert_webhook_url.length > 0
          ? row.bomb_alert_webhook_url
          : null,
      guildLevel,
      bombAlertCalculationMode: isBombCalculationMode(modeRaw)
        ? modeRaw
        : DEFAULT_BOMB_CALCULATION_MODE,
      bombAlertPingHolders: row.bomb_alert_ping_holders === true,
      compactAvailabilityPosts: row.compact_availability_posts === true,
      defaultRoleId:
        typeof row.herald_default_role_id === 'string' &&
        DISCORD_SNOWFLAKE_REGEX.test(row.herald_default_role_id)
          ? row.herald_default_role_id
          : null,
      clusterCode:
        typeof row.cluster_code === 'string' ? row.cluster_code : null
    }
  } catch {
    return { ...DEFAULT_GUILD_HERALD_CONFIG }
  }
}

// Status stays `pending`: `delivered`/`failed` would corrupt the webhook health signal.
export const logSuppressedHeraldDispatch = async (
  supabase: ServiceSupabaseClient,
  params: {
    guildCode: string
    channels: HeraldChannel[]
    transitionLabel: string
    mentionedRoleIds: string[]
  }
): Promise<void> => {
  if (params.channels.length === 0) return
  const firstChannel = params.channels[0]
  if (!firstChannel) return
  const firstHash = createHash('sha256')
    .update(firstChannel.webhookUrl)
    .digest('hex')
  try {
    const { error } = await supabase.from('discord_webhook_logs').insert({
      guild_code: params.guildCode,
      webhook_type: HERALD_WEBHOOK_TYPE,
      webhook_url_hash: firstHash,
      status: 'pending',
      payload_preview: `[suppressed: master_toggle_off] ${params.transitionLabel}`,
      suppressed_by_master_toggle: true,
      mentioned_roles:
        params.mentionedRoleIds.length > 0 ? params.mentionedRoleIds : null
    })
    if (error) {
      logger.warn(
        {
          guild_code: params.guildCode,
          error: error.message
        },
        'herald.suppressed.log_error'
      )
    }
  } catch (err) {
    logger.warn(
      {
        guild_code: params.guildCode,
        error: err instanceof Error ? err.message : String(err)
      },
      'herald.suppressed.log_error'
    )
  }
}

/** Dropped teams get [] (silenced). Never throws. */
export const AUTO_UPDATE_THROTTLE_MS = 60 * 60 * 1000

export const refreshAutoUpdateMappings = async (
  supabase: ServiceSupabaseClient,
  guildCode: string,
  invocationId: string,
  nowMs: number = Date.now()
): Promise<void> => {
  const { data: flagged, error: flaggedError } = await supabase
    .from('herald_meta_role_mapping')
    .select('id, meta_team_slug, last_auto_updated_at')
    .eq('guild_code', guildCode)
    .eq('auto_update', true)

  if (flaggedError) {
    logger.warn(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        error: flaggedError.message
      },
      'herald.auto_update.list_error'
    )
    return
  }
  if (!flagged || flagged.length === 0) return

  const throttleCutoffMs = nowMs - AUTO_UPDATE_THROTTLE_MS
  const staleRows = (
    flagged as Array<{
      id: number
      meta_team_slug: string
      last_auto_updated_at: string | null
    }>
  ).filter((row) => {
    if (!row.last_auto_updated_at) return true
    const lastMs = Date.parse(row.last_auto_updated_at)
    return !Number.isFinite(lastMs) || lastMs < throttleCutoffMs
  })
  if (staleRows.length === 0) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        total_flagged: flagged.length
      },
      'herald.auto_update.throttled'
    )
    return
  }

  const seed = await fetchHeraldSeedFromMetaAtlas(supabase, { topN: 2 })
  const teamToBossIds = new Map<string, string[]>()
  for (const team of seed.teams) {
    teamToBossIds.set(team.meta_team, team.boss_ids)
  }

  const nowIso = new Date(nowMs).toISOString()
  let updated = 0
  let cleared = 0
  for (const row of staleRows) {
    const nextBossIds = teamToBossIds.get(row.meta_team_slug) ?? []
    if (nextBossIds.length === 0) cleared += 1
    else updated += 1
    // Only if auto_update is STILL true, so a concurrent officer flip-off survives.
    const { error: updateError } = await supabase
      .from('herald_meta_role_mapping')
      .update({
        active_boss_ids: nextBossIds,
        last_auto_updated_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', row.id)
      .eq('auto_update', true)
    if (updateError) {
      logger.warn(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          meta_team_slug: row.meta_team_slug,
          error: updateError.message
        },
        'herald.auto_update.row_error'
      )
    }
  }

  logger.info(
    {
      herald_invocation_id: invocationId,
      guild_code: guildCode,
      total_flagged: flagged.length,
      refreshed: staleRows.length,
      with_bosses: updated,
      cleared_to_empty: cleared,
      season: seed.season
    },
    'herald.auto_update.done'
  )
}

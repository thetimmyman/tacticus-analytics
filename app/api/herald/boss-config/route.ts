import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  requireGuildMember,
  requireGuildOfficerOrClusterLeader
} from '@/app/lib/auth/guild-permissions'
import {
  loadHeraldConfigVersionSnapshot,
  parseHeraldSnapshotSelector,
  type BossConfigSnapshot
} from '@/app/lib/herald/config-snapshot'
import { appCache } from '@tacticus/app-core/app-cache'
import type { Json } from '@tacticus/app-core/types'

const logger = createComponentLogger('herald-boss-config')

// Busted locally on POST/DELETE; the season-config aggregator has its own 60s TTL.
const HERALD_BOSS_CONFIG_TTL_SECONDS = 60

const heraldBossConfigKey = (
  guildCode: string,
  bossId: string,
  raritySetSegment: string
): string => `herald_boss_config:${guildCode}:${bossId}:${raritySetSegment}`

const heraldBossConfigInvalidationKeys = (
  guildCode: string,
  bossId: string,
  raritySet: string | null
): string[] => {
  const raritySeg = raritySet ?? '__null__'
  return [
    heraldBossConfigKey(guildCode, bossId, raritySeg), // exact single-row read
    heraldBossConfigKey(guildCode, bossId, '__none__'), // per-boss list
    heraldBossConfigKey(guildCode, '__all__', '__none__'), // full guild list
    heraldBossConfigKey(guildCode, '__all__', raritySeg) // per-rarity guild list
  ]
}

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/
const BOSS_ID_REGEX = /^[A-Za-z][A-Za-z0-9]*_E\d{1,3}$/
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// NULL = catch-all (every stage).
const RARITY_SET_REGEX = /^[LM][1-5]$/
const EXTRA_LABEL_MAX_LEN = 120
const EXTRA_URL_MAX_LEN = 500
const ROLE_LABEL_MAX_LEN = 80
const NOTES_MAX_LEN = 4000

type SideBehaviour = 'skip' | 'kill' | 'threshold'
type PingMode = 'combined' | 'per_side' | 'skip_all'

interface ExtraEntry {
  label: string
  url: string
}

interface RoleRefs {
  refs: string[]
  labelsByRef: Record<string, string>
  hasStructuredEntries: boolean
  error?: string
}

interface BossConfigInput {
  guild_code: string
  boss_id: string
  rarity_set: string | null
  enabled: boolean
  webhook_config_ids: string[]
  discord_role_refs: RoleRefs
  extra_links: ExtraEntry[]
  extra_videos: ExtraEntry[]
  // This Discord message's body replaces the composed message.
  custom_message_url: string | null
  notes: string | null
  side1_notes: string | null
  side2_notes: string | null
  side1_behaviour: SideBehaviour
  side2_behaviour: SideBehaviour
  side1_threshold_hp_pct: number | null
  side2_threshold_hp_pct: number | null
  ping_mode: PingMode
}

type BossConfigRpcError = {
  message: string
}

type BossConfigRpc = (
  fn: 'upsert_herald_boss_config',
  args: Record<string, unknown>
) => {
  single: () => Promise<{
    data: unknown
    error: BossConfigRpcError | null
  }>
}

const normalizeRaritySet = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return RARITY_SET_REGEX.test(trimmed) ? trimmed : null
}

const normalizeUuidList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!UUID_REGEX.test(trimmed)) continue
    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(lower)
  }
  return out
}

const normalizeRoleRefs = (value: unknown): RoleRefs => {
  if (!Array.isArray(value)) {
    return { refs: [], labelsByRef: {}, hasStructuredEntries: false }
  }
  const out: string[] = []
  const seen = new Set<string>()
  const labelsByRef: Record<string, string> = {}
  let hasStructuredEntries = false
  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      hasStructuredEntries = true
      const obj = entry as Record<string, unknown>
      const rawRef = obj.id ?? obj.role_id
      if (typeof rawRef !== 'string') {
        return {
          refs: [],
          labelsByRef: {},
          hasStructuredEntries,
          error: 'Structured Discord role entries require a string id.'
        }
      }
      if (obj.label !== undefined && typeof obj.label !== 'string') {
        return {
          refs: [],
          labelsByRef: {},
          hasStructuredEntries,
          error: 'Structured Discord role labels must be strings.'
        }
      }
      const trimmedRef = rawRef.trim()
      if (!DISCORD_SNOWFLAKE_REGEX.test(trimmedRef)) {
        return {
          refs: [],
          labelsByRef: {},
          hasStructuredEntries,
          error: 'Structured Discord role entries require Discord role IDs.'
        }
      }
    }
    const rawRef =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? ((entry as Record<string, unknown>).id ??
            (entry as Record<string, unknown>).role_id)
          : null
    if (typeof rawRef !== 'string') continue
    const trimmed = rawRef.trim()
    if (trimmed.length === 0) continue
    const dedupeKey = trimmed.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(trimmed)
    if (entry && typeof entry === 'object') {
      const rawLabel = (entry as Record<string, unknown>).label
      if (typeof rawLabel === 'string') {
        const label = rawLabel.trim().slice(0, ROLE_LABEL_MAX_LEN)
        if (label.length > 0) labelsByRef[dedupeKey] = label
      }
    }
  }
  return { refs: out, labelsByRef, hasStructuredEntries }
}

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, NOTES_MAX_LEN) : null
}

const normalizeSideBehaviour = (value: unknown): SideBehaviour => {
  return value === 'skip' || value === 'threshold' ? value : 'kill'
}

const normalizePingMode = (value: unknown): PingMode => {
  if (value === 'combined' || value === 'skip_all') return value
  return 'per_side'
}

const normalizeThreshold = (
  value: unknown,
  behaviour: SideBehaviour
): number | null => {
  if (behaviour !== 'threshold') return null
  const raw =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : NaN
  if (!Number.isFinite(raw)) return null
  const pct = Math.round(raw)
  return pct >= 1 && pct <= 100 ? pct : null
}

const isValidUrl = (value: string): boolean => {
  if (value.length === 0 || value.length > EXTRA_URL_MAX_LEN) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeExtraList = (value: unknown): ExtraEntry[] => {
  if (!Array.isArray(value)) return []
  const out: ExtraEntry[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const rawLabel = typeof obj.label === 'string' ? obj.label.trim() : ''
    const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : ''
    if (!isValidUrl(rawUrl)) continue
    const label =
      rawLabel.length === 0 ? rawUrl : rawLabel.slice(0, EXTRA_LABEL_MAX_LEN)
    out.push({ label, url: rawUrl })
    if (out.length >= 20) break
  }
  return out
}

const normalizeInput = (body: unknown): BossConfigInput | null => {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  const guildCode =
    typeof obj.guild_code === 'string' ? obj.guild_code.trim() : ''
  const bossId = typeof obj.boss_id === 'string' ? obj.boss_id.trim() : ''
  if (!guildCode || !bossId) return null
  if (!BOSS_ID_REGEX.test(bossId)) return null
  const raritySet = normalizeRaritySet(obj.rarity_set)
  if (
    obj.rarity_set !== undefined &&
    obj.rarity_set !== null &&
    typeof obj.rarity_set === 'string' &&
    obj.rarity_set.trim().length > 0 &&
    raritySet === null
  ) {
    return null
  }
  const enabled = obj.enabled === undefined ? true : obj.enabled !== false
  // The RPC also enforces http(s).
  const customMessageUrl = ((): string | null => {
    if (typeof obj.custom_message_url !== 'string') return null
    const trimmed = obj.custom_message_url.trim()
    if (trimmed.length === 0) return null
    if (!/^https?:\/\//.test(trimmed)) return null
    return trimmed
  })()
  const side1Behaviour = normalizeSideBehaviour(obj.side1_behaviour)
  const side2Behaviour = normalizeSideBehaviour(obj.side2_behaviour)
  const side1Threshold = normalizeThreshold(
    obj.side1_threshold_hp_pct,
    side1Behaviour
  )
  const side2Threshold = normalizeThreshold(
    obj.side2_threshold_hp_pct,
    side2Behaviour
  )
  if (side1Behaviour === 'threshold' && side1Threshold === null) return null
  if (side2Behaviour === 'threshold' && side2Threshold === null) return null
  const discordRoleRefs = normalizeRoleRefs(obj.discord_role_ids)
  if (discordRoleRefs.error) return null
  return {
    guild_code: guildCode,
    boss_id: bossId,
    rarity_set: raritySet,
    enabled,
    webhook_config_ids: normalizeUuidList(obj.webhook_config_ids),
    discord_role_refs: discordRoleRefs,
    extra_links: normalizeExtraList(obj.extra_links),
    extra_videos: normalizeExtraList(obj.extra_videos),
    custom_message_url: customMessageUrl,
    notes: normalizeOptionalText(obj.notes),
    side1_notes: normalizeOptionalText(obj.side1_notes),
    side2_notes: normalizeOptionalText(obj.side2_notes),
    side1_behaviour: side1Behaviour,
    side2_behaviour: side2Behaviour,
    side1_threshold_hp_pct: side1Threshold,
    side2_threshold_hp_pct: side2Threshold,
    ping_mode: normalizePingMode(obj.ping_mode)
  }
}

const bossConfigSnapshotToApiRow = (
  row: BossConfigSnapshot,
  guildCode: string,
  snapshotCreatedAt: string,
  index: number
) => ({
  id: -(index + 1),
  guild_code: guildCode,
  boss_id: row.boss_id,
  rarity_set: row.rarity_set,
  enabled: row.enabled,
  webhook_config_ids: row.webhook_config_ids ?? [],
  discord_role_ids: row.discord_role_ids ?? [],
  discord_role_labels: row.discord_role_labels ?? {},
  extra_links: row.extra_links ?? [],
  extra_videos: row.extra_videos ?? [],
  custom_message_url: row.custom_message_url,
  notes: row.notes,
  side1_notes: row.side1_notes,
  side2_notes: row.side2_notes,
  side1_behaviour: row.side1_behaviour,
  side2_behaviour: row.side2_behaviour,
  side1_threshold_hp_pct: row.side1_threshold_hp_pct,
  side2_threshold_hp_pct: row.side2_threshold_hp_pct,
  ping_mode: row.ping_mode,
  ping_mode_explicit: row.ping_mode_explicit,
  updated_at: snapshotCreatedAt
})

const normalizeRoleLookupKey = (value: string): string =>
  value.trim().replace(/^@+/, '').toLowerCase()

const resolveDiscordRoleIds = async (
  supabase: Awaited<ReturnType<typeof db>>,
  guildCode: string,
  roleRefs: RoleRefs
): Promise<{
  ids: string[]
  labels: Record<string, string>
  hasStructuredEntries: boolean
}> => {
  const out: string[] = []
  const seen = new Set<string>()
  const labelsToResolve = new Map<string, string>()
  const labels: Record<string, string> = {}

  for (const ref of roleRefs.refs) {
    const trimmed = ref.trim()
    const label = roleRefs.labelsByRef[trimmed.toLowerCase()]
    if (DISCORD_SNOWFLAKE_REGEX.test(trimmed)) {
      if (!seen.has(trimmed)) {
        seen.add(trimmed)
        out.push(trimmed)
        if (label) labels[trimmed] = label
      }
      continue
    }
    const key = normalizeRoleLookupKey(trimmed)
    if (key.length > 0 && !labelsToResolve.has(key)) {
      labelsToResolve.set(key, trimmed)
    }
  }

  if (labelsToResolve.size === 0) {
    return {
      ids: out,
      labels,
      hasStructuredEntries: roleRefs.hasStructuredEntries
    }
  }

  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- herald_meta_role_mapping display labels are ahead of generated types in this app package
    .from('herald_meta_role_mapping' as any)
    .select('discord_role_id, display_label, meta_team_slug')
    .eq('guild_code', guildCode)
    .not('discord_role_id', 'is', null)

  if (error) {
    logger.error({ err: error, guild_code: guildCode }, 'role lookup failed')
    throw Errors.fetchFailed('Failed to resolve Discord role names', {
      endpoint: '/api/herald/boss-config',
      details: error.message
    })
  }

  const lookup = new Map<string, string>()
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const roleId =
      typeof row.discord_role_id === 'string' &&
      DISCORD_SNOWFLAKE_REGEX.test(row.discord_role_id)
        ? row.discord_role_id
        : null
    if (!roleId) continue
    for (const candidate of [row.display_label, row.meta_team_slug]) {
      if (typeof candidate !== 'string') continue
      const key = normalizeRoleLookupKey(candidate)
      if (key.length > 0 && !lookup.has(key)) lookup.set(key, roleId)
    }
  }

  const unresolved: string[] = []
  for (const [key, original] of labelsToResolve) {
    const roleId = lookup.get(key)
    if (!roleId) {
      unresolved.push(original)
      continue
    }
    if (seen.has(roleId)) continue
    seen.add(roleId)
    out.push(roleId)
    const label = roleRefs.labelsByRef[original.toLowerCase()]
    if (label) labels[roleId] = label
  }

  if (unresolved.length > 0) {
    throw Errors.validation(
      `Unresolved Discord role name${unresolved.length === 1 ? '' : 's'}: ${unresolved.join(', ')}`,
      { endpoint: '/api/herald/boss-config' }
    )
  }

  return {
    ids: out,
    labels,
    hasStructuredEntries: roleRefs.hasStructuredEntries
  }
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/boss-config'
    })
  )

  const url = new URL(req.url)
  const guildCode = url.searchParams.get('guild_code')
  const bossId = url.searchParams.get('boss_id')
  // `?rarity_set=L4`: that row; `?rarity_set=`: the catch-all; omitted: all rows.
  const raritySetParam = url.searchParams.get('rarity_set')
  const snapshotSelector = parseHeraldSnapshotSelector(
    url,
    '/api/herald/boss-config'
  )
  if (!guildCode) {
    throw Errors.validation('guild_code is required', {
      endpoint: '/api/herald/boss-config'
    })
  }
  if (bossId && !BOSS_ID_REGEX.test(bossId)) {
    throw Errors.validation('boss_id must be in <BossType>_E<n> format', {
      endpoint: '/api/herald/boss-config'
    })
  }

  // Authentication alone would expose another guild's webhook and role IDs.
  await requireGuildMember(
    supabase,
    user.id,
    guildCode,
    '/api/herald/boss-config'
  )

  if (snapshotSelector) {
    const version = await loadHeraldConfigVersionSnapshot(
      supabase,
      guildCode,
      snapshotSelector,
      '/api/herald/boss-config'
    )
    let rows = version
      ? version.config_snapshot.herald_boss_config.map((row, index) =>
          bossConfigSnapshotToApiRow(row, guildCode, version.created_at, index)
        )
      : []

    if (bossId) rows = rows.filter((row) => row.boss_id === bossId)
    if (raritySetParam !== null) {
      if (raritySetParam === '') {
        rows = rows.filter((row) => row.rarity_set === null)
      } else {
        const normalized = normalizeRaritySet(raritySetParam)
        if (!normalized) {
          throw Errors.validation('rarity_set must match `[L|M][1-5]`', {
            endpoint: '/api/herald/boss-config'
          })
        }
        rows = rows.filter((row) => row.rarity_set === normalized)
      }
    }

    const snapshotMeta = version
      ? {
          id: version.id,
          guild_code: version.guild_code,
          season: version.season,
          is_default: version.is_default,
          created_at: version.created_at
        }
      : null

    if (bossId && raritySetParam !== null) {
      return NextResponse.json({
        success: true,
        config: rows[0] ?? null,
        snapshot: snapshotMeta
      })
    }
    return NextResponse.json({
      success: true,
      configs: rows,
      snapshot: snapshotMeta
    })
  }

  // Normalize first so rejected input does not pollute the cache namespace.
  let normalizedRaritySetForKey: string | null | undefined = undefined
  if (raritySetParam !== null) {
    if (raritySetParam === '') {
      normalizedRaritySetForKey = null
    } else {
      const normalized = normalizeRaritySet(raritySetParam)
      if (!normalized) {
        throw Errors.validation('rarity_set must match `[L|M][1-5]`', {
          endpoint: '/api/herald/boss-config'
        })
      }
      normalizedRaritySetForKey = normalized
    }
  }
  const raritySegment =
    normalizedRaritySetForKey === undefined
      ? '__none__'
      : normalizedRaritySetForKey === null
        ? '__null__'
        : normalizedRaritySetForKey
  const cacheKey = heraldBossConfigKey(
    guildCode,
    bossId ?? '__all__',
    raritySegment
  )
  const cached = await appCache.get<Record<string, unknown>>(cacheKey)
  if (cached !== null && cached !== undefined) {
    return NextResponse.json(cached)
  }

  let query = supabase
    .from('herald_boss_config')
    .select(
      'id, guild_code, boss_id, rarity_set, enabled, webhook_config_ids, discord_role_ids, discord_role_labels, extra_links, extra_videos, custom_message_url, notes, side1_notes, side2_notes, side1_behaviour, side2_behaviour, side1_threshold_hp_pct, side2_threshold_hp_pct, ping_mode, ping_mode_explicit, updated_at'
    )
    .eq('guild_code', guildCode)

  if (bossId) {
    if (!BOSS_ID_REGEX.test(bossId)) {
      throw Errors.validation('boss_id must be in <BossType>_E<n> format', {
        endpoint: '/api/herald/boss-config'
      })
    }
    query = query.eq('boss_id', bossId)
  } else {
    query = query.order('boss_id', { ascending: true })
  }

  if (raritySetParam !== null) {
    if (raritySetParam === '') {
      query = query.is('rarity_set', null)
    } else {
      const normalized = normalizeRaritySet(raritySetParam)
      if (!normalized) {
        throw Errors.validation('rarity_set must match `[L|M][1-5]`', {
          endpoint: '/api/herald/boss-config'
        })
      }
      query = query.eq('rarity_set', normalized)
    }
  }

  const { data, error } = await query
  if (error) {
    logger.error({ err: error }, 'Error fetching herald boss config')
    throw Errors.fetchFailed('Failed to fetch Herald boss config', {
      endpoint: '/api/herald/boss-config',
      details: error.message
    })
  }

  if (bossId && raritySetParam !== null) {
    const singleRowResponse = {
      success: true,
      config: (data as unknown[] | null)?.[0] ?? null
    }
    await appCache.set(
      cacheKey,
      singleRowResponse,
      HERALD_BOSS_CONFIG_TTL_SECONDS
    )
    return NextResponse.json(singleRowResponse)
  }
  const listResponse = { success: true, configs: data ?? [] }
  await appCache.set(cacheKey, listResponse, HERALD_BOSS_CONFIG_TTL_SECONDS)
  return NextResponse.json(listResponse)
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/boss-config'
    })
  )

  const body = await req.json().catch(() => null)
  const input = normalizeInput(body)
  if (!input) {
    throw Errors.validation(
      'guild_code and boss_id (in <BossType>_E<n> format) are required',
      { endpoint: '/api/herald/boss-config' }
    )
  }

  await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    input.guild_code,
    '/api/herald/boss-config'
  )

  const discordRoles = await resolveDiscordRoleIds(
    supabase,
    input.guild_code,
    input.discord_role_refs
  )
  const roleLabelsPayload = input.discord_role_refs.hasStructuredEntries
    ? (discordRoles.labels as unknown as Json)
    : null

  try {
    // RPC upsert: onConflict cannot target partial unique indexes (42P10). rpc is erased to avoid TS2589.
    const rpc = supabase.rpc as unknown as (...args: unknown[]) => unknown
    const upsertBossConfig = rpc.bind(supabase) as unknown as BossConfigRpc
    const { data, error } = await upsertBossConfig(
      'upsert_herald_boss_config',
      {
        p_guild_code: input.guild_code,
        p_boss_id: input.boss_id,
        p_rarity_set: input.rarity_set,
        p_enabled: input.enabled,
        p_webhook_config_ids: input.webhook_config_ids,
        p_discord_role_ids: discordRoles.ids,
        p_discord_role_labels: roleLabelsPayload,
        // Legacy DB parameters, not part of the public API.
        p_pinned_replay_ids: [],
        p_replay_auto_count: 0,
        p_replay_link_mode: 'off',
        p_extra_links: input.extra_links as unknown as Json,
        p_extra_videos: input.extra_videos as unknown as Json,
        p_custom_message_url: input.custom_message_url,
        p_notes: input.notes,
        p_side1_notes: input.side1_notes,
        p_side2_notes: input.side2_notes,
        p_side1_behaviour: input.side1_behaviour,
        p_side2_behaviour: input.side2_behaviour,
        p_side1_threshold_hp_pct: input.side1_threshold_hp_pct,
        p_side2_threshold_hp_pct: input.side2_threshold_hp_pct,
        p_ping_mode: input.ping_mode,
        p_updated_by: user.id
      }
    ).single()

    if (error) {
      logger.error({ err: error }, 'Error saving herald boss config')
      throw Errors.updateFailed('Failed to save Herald boss config', {
        endpoint: '/api/herald/boss-config',
        details: error.message
      })
    }

    await Promise.all(
      heraldBossConfigInvalidationKeys(
        input.guild_code,
        input.boss_id,
        input.rarity_set
      ).map((k) => appCache.del(k))
    )

    return NextResponse.json({ success: true, config: data })
  } catch (error) {
    rethrowIfAppError(error)
    throw error
  }
})

export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/boss-config'
    })
  )

  const url = new URL(req.url)
  const guildCode = url.searchParams.get('guild_code')
  const bossId = url.searchParams.get('boss_id')
  const raritySetParam = url.searchParams.get('rarity_set')
  if (!guildCode || !bossId) {
    throw Errors.validation('guild_code and boss_id are required', {
      endpoint: '/api/herald/boss-config'
    })
  }
  if (!BOSS_ID_REGEX.test(bossId)) {
    throw Errors.validation('boss_id must be in <BossType>_E<n> format', {
      endpoint: '/api/herald/boss-config'
    })
  }
  let raritySet: string | null = null
  if (raritySetParam !== null && raritySetParam !== '') {
    raritySet = normalizeRaritySet(raritySetParam)
    if (!raritySet) {
      throw Errors.validation('rarity_set must match `[L|M][1-5]`', {
        endpoint: '/api/herald/boss-config'
      })
    }
  }

  await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    guildCode,
    '/api/herald/boss-config'
  )

  let deleteQuery = supabase
    .from('herald_boss_config')
    .delete()
    .eq('guild_code', guildCode)
    .eq('boss_id', bossId)
  deleteQuery =
    raritySet === null
      ? deleteQuery.is('rarity_set', null)
      : deleteQuery.eq('rarity_set', raritySet)

  const { error } = await deleteQuery

  if (error) {
    logger.error({ err: error }, 'Error deleting herald boss config')
    throw Errors.updateFailed('Failed to delete Herald boss config', {
      endpoint: '/api/herald/boss-config',
      details: error.message
    })
  }

  await Promise.all(
    heraldBossConfigInvalidationKeys(guildCode, bossId, raritySet).map((k) =>
      appCache.del(k)
    )
  )

  return NextResponse.json({ success: true })
})

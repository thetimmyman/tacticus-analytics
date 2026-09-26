import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { appCache } from '@tacticus/app-core/app-cache'
import { SEASON_CONFIG_TTL_SECONDS, seasonConfigCacheKey } from './_cache'
import {
  parseSeasonNoteField,
  resolveNoteOverride
} from '@/app/lib/boss-ops/season-note-field'

const logger = createComponentLogger('season-config')

// Write routes bust the cache via ./_cache; herald and target-token writes rely on the TTL.

// Effective per-stage Herald + planner config, with `specific` and NULL-stage `fallback` rows.
// bossType is the canonical Herald bossType, not the playbook slug.

const RARITY_SET_REGEX = /^[LM][1-5]$/
const BOSS_TYPE_REGEX = /^[A-Za-z][A-Za-z0-9]{0,80}$/

interface HeraldBossConfigSnapshot {
  id: number
  rarity_set: string | null
  enabled: boolean
  webhook_config_ids: string[]
  discord_role_ids: string[]
  extra_links: unknown[]
  extra_videos: unknown[]
  notes: string | null
  side1_notes: string | null
  side2_notes: string | null
  side1_behaviour: 'skip' | 'kill' | 'threshold'
  side2_behaviour: 'skip' | 'kill' | 'threshold'
  side1_threshold_hp_pct: number | null
  side2_threshold_hp_pct: number | null
  ping_mode: 'combined' | 'per_side' | 'skip_all'
  ping_mode_explicit: boolean
  updated_at: string | null
}

interface RoleMappingSnapshot {
  id: number
  meta_team_slug: string
  rarity_set: string | null
  discord_role_id: string | null
  display_label: string | null
  enabled: boolean
  active_boss_ids: string[] | null
  auto_update: boolean
  updated_at: string | null
}

interface EncounterPayload {
  encounter_index: 0 | 1 | 2
  boss_id: string
  display_name: string
  encounter_type: 'main' | 'prime1' | 'prime2'
  boss_config: {
    specific: HeraldBossConfigSnapshot | null
    fallback: HeraldBossConfigSnapshot | null
    effective: HeraldBossConfigSnapshot | null
    origin: 'per-stage' | 'guild-default' | 'none'
  }
  // Null = not configured.
  skipped: boolean | null
  target_tokens: number | null
  // 0 = defeat fires at HP=0. Null for mains.
  kill_threshold_pct: number | null
  // Resolved against legacy notes; a cleared season note stays null and clients must not fall back.
  notes: string | null
}

interface RoleMappingGroupPayload {
  meta_team_slug: string
  display_label: string | null
  specific: RoleMappingSnapshot | null
  fallback: RoleMappingSnapshot | null
  effective: RoleMappingSnapshot | null
  origin: 'per-stage' | 'guild-default' | 'none'
  applies_to: boolean[]
}

const ENCOUNTER_TYPE_BY_INDEX: Record<number, 'main' | 'prime1' | 'prime2'> = {
  0: 'main',
  1: 'prime1',
  2: 'prime2'
}

const pickEffective = <T extends { rarity_set: string | null }>(
  specific: T | null,
  fallback: T | null
): { effective: T | null; origin: 'per-stage' | 'guild-default' | 'none' } => {
  if (specific) return { effective: specific, origin: 'per-stage' }
  if (fallback) return { effective: fallback, origin: 'guild-default' }
  return { effective: null, origin: 'none' }
}

const normalizeBossConfigRow = (
  row: Record<string, unknown> | null
): HeraldBossConfigSnapshot | null => {
  if (!row || typeof row !== 'object') return null
  return {
    id: typeof row.id === 'number' ? row.id : Number(row.id ?? 0),
    rarity_set:
      typeof row.rarity_set === 'string' && row.rarity_set.length > 0
        ? row.rarity_set
        : null,
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
    extra_links: Array.isArray(row.extra_links)
      ? (row.extra_links as unknown[])
      : [],
    extra_videos: Array.isArray(row.extra_videos)
      ? (row.extra_videos as unknown[])
      : [],
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
    ping_mode_explicit: row.ping_mode_explicit === true,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null
  }
}

const normalizeRoleMappingRow = (
  row: Record<string, unknown> | null
): RoleMappingSnapshot | null => {
  if (!row || typeof row !== 'object') return null
  return {
    id: typeof row.id === 'number' ? row.id : Number(row.id ?? 0),
    meta_team_slug:
      typeof row.meta_team_slug === 'string' ? row.meta_team_slug : '',
    rarity_set:
      typeof row.rarity_set === 'string' && row.rarity_set.length > 0
        ? row.rarity_set
        : null,
    discord_role_id:
      typeof row.discord_role_id === 'string' && row.discord_role_id.length > 0
        ? row.discord_role_id
        : null,
    display_label:
      typeof row.display_label === 'string' ? row.display_label : null,
    enabled: row.enabled !== false,
    active_boss_ids: Array.isArray(row.active_boss_ids)
      ? (row.active_boss_ids as unknown[]).filter(
          (v): v is string => typeof v === 'string' && v.length > 0
        )
      : null,
    auto_update: row.auto_update === true,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null
  }
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/season-config'
    })
  )

  const url = new URL(req.url)
  const guildCode = url.searchParams.get('guildCode')?.trim() ?? ''
  const bossType = url.searchParams.get('bossType')?.trim() ?? ''
  const raritySet = url.searchParams.get('raritySet')?.trim() ?? ''
  const seasonStr = url.searchParams.get('season')?.trim() ?? ''

  if (!guildCode) {
    throw Errors.validation('guildCode is required', {
      endpoint: '/api/season-config'
    })
  }
  if (!BOSS_TYPE_REGEX.test(bossType)) {
    throw Errors.validation(
      'bossType is required (CamelCase, A-Za-z0-9, max 80 chars)',
      {
        endpoint: '/api/season-config'
      }
    )
  }
  if (!RARITY_SET_REGEX.test(raritySet)) {
    throw Errors.validation('raritySet must match `[L|M][1-5]`', {
      endpoint: '/api/season-config'
    })
  }

  // Members must not read this data.
  await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    guildCode,
    '/api/season-config'
  )

  // Auth runs on every request and the payload is per-guild, so a shared cache is safe.
  const cacheKey = seasonConfigCacheKey(
    guildCode,
    bossType,
    raritySet,
    seasonStr
  )
  const cached = await appCache.get<Record<string, unknown>>(cacheKey)
  if (cached !== null && cached !== undefined) {
    return NextResponse.json(cached)
  }

  const bossIds: string[] = [0, 1, 2].map((idx) => `${bossType}_E${idx}`)

  type Maybe<T> = T | null
  type RawResult = { data: Maybe<unknown>; error: Maybe<{ message: string }> }

  const rarity = raritySet[0] === 'M' ? 'Mythic' : 'Legendary'
  const setNumber = parseInt(raritySet.slice(1), 10)

  const [
    bossConfigsResult,
    roleMappingsResult,
    bossNamesResult,
    seasonRowResult,
    targetTokensResult
  ] = (await Promise.all([
    supabase
      .from('herald_boss_config')
      .select(
        'id, boss_id, rarity_set, enabled, webhook_config_ids, discord_role_ids, extra_links, extra_videos, notes, side1_notes, side2_notes, side1_behaviour, side2_behaviour, side1_threshold_hp_pct, side2_threshold_hp_pct, ping_mode, ping_mode_explicit, updated_at'
      )
      .eq('guild_code', guildCode)
      .in('boss_id', bossIds),

    supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types do not include herald_meta_role_mapping yet
      .from('herald_meta_role_mapping' as any)
      .select(
        'id, meta_team_slug, rarity_set, discord_role_id, display_label, enabled, active_boss_ids, auto_update, updated_at'
      )
      .eq('guild_code', guildCode)
      .eq('enabled', true),
    supabase
      .from('boss_mapping')
      .select('encounter_index, boss_name')
      .eq('boss_type', bossType),
    seasonStr.length > 0
      ? supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types do not include upcoming_season_bosses yet
          .from('upcoming_season_bosses' as any)
          .select('level, sub_bosses')
          .eq('guild_code', guildCode)
          .eq('season_number', seasonStr)
          .eq('level', raritySet)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // boss_name may be the display name; boss_mapping bridges bossType to display.
    Number.isFinite(setNumber) && setNumber >= 1 && setNumber <= 5
      ? supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types do not include boss_target_tokens yet
          .from('boss_target_tokens' as any)
          .select('boss_name, encounter_id, target_tokens, skip')
          .eq('guild_code', guildCode)
          .eq('rarity', rarity)
          .eq('set', setNumber)
      : Promise.resolve({ data: null, error: null })
  ])) as unknown as [RawResult, RawResult, RawResult, RawResult, RawResult]

  const bossConfigsRows =
    (bossConfigsResult.data as Maybe<Array<Record<string, unknown>>>) ?? []
  const roleMappingsRows =
    (roleMappingsResult.data as Maybe<Array<Record<string, unknown>>>) ?? []
  const bossNameRows =
    (bossNamesResult.data as Maybe<
      Array<{ encounter_index: number; boss_name: string }>
    >) ?? []
  const seasonRow = seasonRowResult.data as Maybe<Record<string, unknown>>
  const targetTokenRows =
    (targetTokensResult.data as Maybe<Array<Record<string, unknown>>>) ?? []

  if (bossConfigsResult.error) {
    logger.warn(
      { err: bossConfigsResult.error.message, guildCode, bossType },
      'season_config.boss_config.error'
    )
  }
  if (roleMappingsResult.error) {
    logger.warn(
      { err: roleMappingsResult.error.message, guildCode },
      'season_config.role_mappings.error'
    )
  }
  if (bossNamesResult.error) {
    logger.warn(
      { err: bossNamesResult.error.message, bossType },
      'season_config.boss_names.error'
    )
  }
  if (seasonRowResult.error) {
    logger.warn(
      { err: seasonRowResult.error.message, guildCode, seasonStr, raritySet },
      'season_config.season_row.error'
    )
  }
  if (targetTokensResult.error) {
    logger.warn(
      { err: targetTokensResult.error.message, guildCode, rarity, setNumber },
      'season_config.target_tokens.error'
    )
  }

  const displayNameByIdx = new Map<number, string>()
  for (const row of bossNameRows) {
    if (
      typeof row.encounter_index === 'number' &&
      typeof row.boss_name === 'string'
    ) {
      displayNameByIdx.set(row.encounter_index, row.boss_name)
    }
  }

  // boss_name is canonically the CamelCase slug; legacy rows use the display name.
  const findTargetTokenRow = (encounterIndex: number) => {
    const bySlug = targetTokenRows.find(
      (r) => r.boss_name === bossType && r.encounter_id === encounterIndex
    )
    if (bySlug) return bySlug
    const display = displayNameByIdx.get(encounterIndex) ?? null
    if (display) {
      return targetTokenRows.find(
        (r) => r.boss_name === display && r.encounter_id === encounterIndex
      )
    }
    return undefined
  }

  const bossConfigsByKey = new Map<string, HeraldBossConfigSnapshot>()
  for (const raw of bossConfigsRows) {
    const row = raw as Record<string, unknown>
    const bossId = typeof row.boss_id === 'string' ? row.boss_id : null
    if (!bossId) continue
    const normalized = normalizeBossConfigRow(row)
    if (!normalized) continue
    const key = `${bossId}|${normalized.rarity_set ?? '__null__'}`
    bossConfigsByKey.set(key, normalized)
  }

  const encounters: EncounterPayload[] = bossIds.map((bossId, idx) => {
    const encounterIndex = idx as 0 | 1 | 2
    const specific = bossConfigsByKey.get(`${bossId}|${raritySet}`) ?? null
    const fallback = bossConfigsByKey.get(`${bossId}|__null__`) ?? null
    const { effective, origin } = pickEffective(specific, fallback)

    // Mains have no skip (null); a missing prime row means active; skip=true overrides.
    let skipped: boolean | null = null
    let targetTokens: number | null = null
    let killThresholdPct: number | null = null
    if (encounterIndex > 0) {
      let s = false
      if (seasonRow) {
        const subBosses = seasonRow.sub_bosses as Record<string, unknown> | null
        if (subBosses && typeof subBosses === 'object') {
          const skipKey = `sub${encounterIndex}_skip`
          if (subBosses[skipKey] === true) s = true
          const pctKey = `sub${encounterIndex}_kill_threshold_pct`
          const rawPct = subBosses[pctKey]
          if (typeof rawPct === 'number' && Number.isFinite(rawPct)) {
            killThresholdPct = rawPct
          } else if (typeof rawPct === 'string') {
            const n = Number.parseFloat(rawPct)
            if (Number.isFinite(n)) killThresholdPct = n
          }
        }
      }
      // Unconfigured means 0 to avoid null-vs-zero ambiguity.
      if (killThresholdPct === null) killThresholdPct = 0
      const skipRow = findTargetTokenRow(encounterIndex)
      if (skipRow && skipRow.skip === true) s = true
      skipped = s
    }
    const tt = findTargetTokenRow(encounterIndex)
    if (
      tt &&
      typeof tt.target_tokens === 'number' &&
      Number.isFinite(tt.target_tokens)
    ) {
      targetTokens = tt.target_tokens
    } else if (tt && typeof tt.target_tokens === 'string') {
      // PostgREST may return NUMERIC as a string.
      const n = parseFloat(tt.target_tokens as string)
      if (Number.isFinite(n)) targetTokens = n
    }

    // Notes are three-state; resolving here keeps a cleared season note from resurfacing legacy text.
    let seasonNoteOverride: string | null | undefined
    if (seasonRow) {
      const subBosses = seasonRow.sub_bosses as Record<string, unknown> | null
      if (subBosses && typeof subBosses === 'object') {
        const noteKey =
          encounterIndex === 0
            ? 'main_notes'
            : encounterIndex === 1
              ? 'side1_notes'
              : 'side2_notes'
        seasonNoteOverride = parseSeasonNoteField(subBosses[noteKey])
      }
    }
    const legacyNote =
      encounterIndex === 0
        ? (effective?.notes ?? null)
        : encounterIndex === 1
          ? (effective?.side1_notes ?? null)
          : (effective?.side2_notes ?? null)
    const perSeasonNotes = resolveNoteOverride(seasonNoteOverride, legacyNote)

    const encounterType = ENCOUNTER_TYPE_BY_INDEX[encounterIndex] ?? 'main'
    return {
      encounter_index: encounterIndex,
      boss_id: bossId,
      display_name: displayNameByIdx.get(encounterIndex) ?? bossId,
      encounter_type: encounterType,
      boss_config: { specific, fallback, effective, origin },
      skipped,
      target_tokens: targetTokens,
      kill_threshold_pct: killThresholdPct,
      notes: perSeasonNotes
    }
  })

  let perSeasonPingMode: 'combined' | 'per_side' | 'skip_all' | null = null
  if (seasonRow) {
    const subBosses = seasonRow.sub_bosses as Record<string, unknown> | null
    if (subBosses && typeof subBosses === 'object') {
      const raw = subBosses.ping_mode
      if (raw === 'combined' || raw === 'per_side' || raw === 'skip_all') {
        perSeasonPingMode = raw
      }
    }
  }

  const mappingsBySlug = new Map<
    string,
    {
      specific: RoleMappingSnapshot | null
      fallback: RoleMappingSnapshot | null
    }
  >()
  for (const raw of roleMappingsRows) {
    const normalized = normalizeRoleMappingRow(raw as Record<string, unknown>)
    if (!normalized || !normalized.meta_team_slug) continue
    const bucket = mappingsBySlug.get(normalized.meta_team_slug) ?? {
      specific: null,
      fallback: null
    }
    if (normalized.rarity_set === raritySet) bucket.specific = normalized
    else if (normalized.rarity_set === null) bucket.fallback = normalized
    mappingsBySlug.set(normalized.meta_team_slug, bucket)
  }

  const roleMappings: RoleMappingGroupPayload[] = Array.from(
    mappingsBySlug.entries()
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, bucket]) => {
      const { effective, origin } = pickEffective(
        bucket.specific,
        bucket.fallback
      )
      const appliesTo: boolean[] = bossIds.map((bossId) => {
        if (!effective) return false
        if (effective.active_boss_ids === null) return true
        if (effective.active_boss_ids.length === 0) return false
        return effective.active_boss_ids.includes(bossId)
      })
      return {
        meta_team_slug: slug,
        display_label:
          effective?.display_label ??
          bucket.fallback?.display_label ??
          bucket.specific?.display_label ??
          null,
        specific: bucket.specific,
        fallback: bucket.fallback,
        effective,
        origin,
        applies_to: appliesTo
      }
    })

  const responseBody = {
    success: true,
    guild_code: guildCode,
    boss_type: bossType,
    rarity_set: raritySet,
    season: seasonStr.length > 0 ? seasonStr : null,
    encounters,
    role_mappings: roleMappings,
    ping_mode: perSeasonPingMode
  }
  await appCache.set(cacheKey, responseBody, SEASON_CONFIG_TTL_SECONDS)
  return NextResponse.json(responseBody)
})

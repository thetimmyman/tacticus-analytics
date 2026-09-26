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
  type MetaRoleMappingSnapshot
} from '@/app/lib/herald/config-snapshot'

const logger = createComponentLogger('herald-role-mappings')

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/
const META_TEAM_SLUG_MAX_LEN = 80
const RARITY_SET_REGEX = /^[LM][1-5]$/

interface MappingInput {
  guild_code: string
  meta_team_slug: string
  // NULL = catch-all (every stage).
  rarity_set: string | null
  discord_role_id: string | null
  display_label: string | null
  active_boss_ids: string[] | null
  enabled: boolean
  auto_update: boolean
  prime_scope: 'main' | 'prime_a' | 'prime_b' | 'all'
  track_only: boolean
  custom_message_only: boolean
}

const normalizeRaritySet = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return RARITY_SET_REGEX.test(trimmed) ? trimmed : null
}

// Matches buildBossId at Herald detect time.
const BOSS_ID_REGEX = /^[A-Za-z][A-Za-z0-9]*_E\d{1,3}$/

const normalizeBossIds = (value: unknown): string[] | null => {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) return null
  const cleaned: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!BOSS_ID_REGEX.test(trimmed)) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    cleaned.push(trimmed)
  }
  return cleaned
}

const roleMappingSnapshotToApiRow = (
  row: MetaRoleMappingSnapshot,
  guildCode: string,
  snapshotCreatedAt: string,
  index: number
) => ({
  id: -(index + 1),
  guild_code: guildCode,
  meta_team_slug: row.meta_team_slug,
  rarity_set: row.rarity_set,
  discord_role_id: row.discord_role_id,
  display_label: row.display_label,
  enabled: row.enabled,
  active_boss_ids: row.active_boss_ids,
  auto_update: row.auto_update,
  prime_scope: row.prime_scope,
  track_only: row.track_only,
  custom_message_only: row.custom_message_only,
  updated_at: snapshotCreatedAt
})

const normalizeInput = (body: unknown): MappingInput | null => {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  const guildCode =
    typeof obj.guild_code === 'string' ? obj.guild_code.trim() : ''
  const slug =
    typeof obj.meta_team_slug === 'string' ? obj.meta_team_slug.trim() : ''
  // Null (seeded row awaiting input) or a snowflake; '' is treated as null.
  const rawRoleId =
    typeof obj.discord_role_id === 'string' ? obj.discord_role_id.trim() : null
  let roleId: string | null
  if (rawRoleId === null || rawRoleId === '') {
    roleId = null
  } else if (DISCORD_SNOWFLAKE_REGEX.test(rawRoleId)) {
    roleId = rawRoleId
  } else {
    return null
  }
  const label =
    typeof obj.display_label === 'string' && obj.display_label.trim().length > 0
      ? obj.display_label.trim()
      : null
  if (!guildCode || !slug) return null
  if (slug.length > META_TEAM_SLUG_MAX_LEN) return null
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
  const activeBossIds = normalizeBossIds(obj.active_boss_ids)
  const enabled = obj.enabled === undefined ? true : obj.enabled !== false
  const autoUpdate =
    obj.auto_update === undefined ? false : Boolean(obj.auto_update)
  const primeScopeRaw =
    typeof obj.prime_scope === 'string' ? obj.prime_scope.trim() : 'all'
  const primeScope: 'main' | 'prime_a' | 'prime_b' | 'all' =
    primeScopeRaw === 'main' ||
    primeScopeRaw === 'prime_a' ||
    primeScopeRaw === 'prime_b'
      ? primeScopeRaw
      : 'all'
  const trackOnly = obj.track_only === true
  const customMessageOnly = obj.custom_message_only === true
  return {
    guild_code: guildCode,
    meta_team_slug: slug,
    rarity_set: raritySet,
    discord_role_id: roleId,
    display_label: label,
    active_boss_ids: activeBossIds,
    enabled,
    auto_update: autoUpdate,
    prime_scope: primeScope,
    track_only: trackOnly,
    custom_message_only: customMessageOnly
  }
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/role-mappings'
    })
  )

  const url = new URL(req.url)
  const guildCode = url.searchParams.get('guild_code')
  if (!guildCode) {
    throw Errors.validation('guild_code is required', {
      endpoint: '/api/herald/role-mappings'
    })
  }

  // `?rarity_set=` returns catch-all rows; omitted means no filter.
  const raritySetParam = url.searchParams.get('rarity_set')
  const snapshotSelector = parseHeraldSnapshotSelector(
    url,
    '/api/herald/role-mappings'
  )

  // RLS alone would give non-members an empty list, and RLS drift would leak Discord role IDs.
  await requireGuildMember(
    supabase,
    user.id,
    guildCode,
    '/api/herald/role-mappings'
  )

  if (snapshotSelector) {
    const version = await loadHeraldConfigVersionSnapshot(
      supabase,
      guildCode,
      snapshotSelector,
      '/api/herald/role-mappings'
    )
    const rows = version
      ? version.config_snapshot.herald_meta_role_mapping.map((row, index) =>
          roleMappingSnapshotToApiRow(row, guildCode, version.created_at, index)
        )
      : []
    const filtered =
      raritySetParam === null
        ? rows
        : raritySetParam === ''
          ? rows.filter((row) => row.rarity_set === null)
          : rows.filter((row) => {
              const normalized = normalizeRaritySet(raritySetParam)
              if (!normalized) {
                throw Errors.validation('rarity_set must match `[L|M][1-5]`', {
                  endpoint: '/api/herald/role-mappings'
                })
              }
              return row.rarity_set === normalized
            })

    return NextResponse.json({
      success: true,
      mappings: filtered,
      snapshot: version
        ? {
            id: version.id,
            guild_code: version.guild_code,
            season: version.season,
            is_default: version.is_default,
            created_at: version.created_at
          }
        : null
    })
  }

  let query = supabase
    .from('herald_meta_role_mapping')
    .select(
      'id, guild_code, meta_team_slug, rarity_set, discord_role_id, display_label, enabled, active_boss_ids, auto_update, prime_scope, track_only, custom_message_only, updated_at'
    )
    .eq('guild_code', guildCode)
    .order('meta_team_slug', { ascending: true })

  if (raritySetParam !== null) {
    if (raritySetParam === '') {
      query = query.is('rarity_set', null)
    } else {
      const normalized = normalizeRaritySet(raritySetParam)
      if (!normalized) {
        throw Errors.validation('rarity_set must match `[L|M][1-5]`', {
          endpoint: '/api/herald/role-mappings'
        })
      }
      query = query.eq('rarity_set', normalized)
    }
  }

  const { data, error } = await query
  if (error) {
    logger.error({ err: error }, 'Error fetching herald role mappings')
    throw Errors.fetchFailed('Failed to fetch Herald role mappings', {
      endpoint: '/api/herald/role-mappings',
      details: error.message
    })
  }

  return NextResponse.json({ success: true, mappings: data ?? [] })
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/role-mappings'
    })
  )

  const body = await req.json().catch(() => null)
  const input = normalizeInput(body)
  if (!input) {
    throw Errors.validation(
      'guild_code, meta_team_slug (a-z, 0-9, _, -), and discord_role_id (17-20 digits) are required',
      { endpoint: '/api/herald/role-mappings' }
    )
  }

  await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    input.guild_code,
    '/api/herald/role-mappings'
  )

  try {
    // PostgREST onConflict cannot target partial unique indexes (42P10).
    const { data, error } = await supabase
      .rpc('upsert_herald_role_mapping', {
        p_guild_code: input.guild_code,
        p_meta_team_slug: input.meta_team_slug,
        p_rarity_set: input.rarity_set,
        p_discord_role_id: input.discord_role_id,
        p_display_label: input.display_label,
        p_enabled: input.enabled,
        p_active_boss_ids: input.active_boss_ids,
        p_auto_update: input.auto_update,
        p_prime_scope: input.prime_scope,
        p_track_only: input.track_only,
        p_custom_message_only: input.custom_message_only,
        p_updated_by: user.id
      })
      .single()

    if (error) {
      logger.error({ err: error }, 'Error saving herald role mapping')
      throw Errors.updateFailed('Failed to save Herald role mapping', {
        endpoint: '/api/herald/role-mappings',
        details: error.message
      })
    }

    return NextResponse.json({ success: true, mapping: data })
  } catch (error) {
    rethrowIfAppError(error)
    throw error
  }
})

export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/role-mappings'
    })
  )

  const url = new URL(req.url)
  const guildCode = url.searchParams.get('guild_code')
  const slug = url.searchParams.get('meta_team_slug')
  const raritySetParam = url.searchParams.get('rarity_set')
  if (!guildCode || !slug) {
    throw Errors.validation('guild_code and meta_team_slug are required', {
      endpoint: '/api/herald/role-mappings'
    })
  }
  let raritySet: string | null = null
  if (raritySetParam !== null && raritySetParam !== '') {
    raritySet = normalizeRaritySet(raritySetParam)
    if (!raritySet) {
      throw Errors.validation('rarity_set must match `[L|M][1-5]`', {
        endpoint: '/api/herald/role-mappings'
      })
    }
  }

  await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    guildCode,
    '/api/herald/role-mappings'
  )

  let deleteQuery = supabase
    .from('herald_meta_role_mapping')
    .delete()
    .eq('guild_code', guildCode)
    .eq('meta_team_slug', slug.trim())
  deleteQuery =
    raritySet === null
      ? deleteQuery.is('rarity_set', null)
      : deleteQuery.eq('rarity_set', raritySet)

  const { error } = await deleteQuery

  if (error) {
    logger.error({ err: error }, 'Error deleting herald role mapping')
    throw Errors.updateFailed('Failed to delete Herald role mapping', {
      endpoint: '/api/herald/role-mappings',
      details: error.message
    })
  }

  return NextResponse.json({ success: true })
})

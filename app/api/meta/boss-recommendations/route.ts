import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { resolveDagProgression } from '@/app/lib/meta/dag-progression'
import {
  parseRosterPayload,
  type RosterInputEntry
} from '@/app/lib/meta/roster-input'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.boss-recommendations')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { appCache } from '@tacticus/app-core/app-cache'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'

// GET only (POST takes a custom roster); the key must cover every payload-affecting param.
const META_BOSS_RECS_TTL_SECONDS = 5 * 60

export interface BossRecommendation {
  team_hash: string
  team_composition: string
  meta_team: string | null
  rarity_set: string | null
  sub_boss_name: string | null
  encounter_index: number
  damage_p90: number
  damage_p75: number
  damage_max: number
  damage_avg: number
  attack_count: number
  season: string
}

interface RaidBossInfo {
  raid_boss: string | null
  encounter_index: number
}

type BossMappingLookup = Map<string, RaidBossInfo>

async function loadBossMappings(
  supabase: TypedSupabaseClient,
  bossType: string
): Promise<BossMappingLookup> {
  const lookup = new Map<string, RaidBossInfo>()

  const { data: byBossName, error: byNameError } = await supabase
    .from('boss_mapping')
    .select('boss_type, boss_name, encounter_index')
    .ilike('boss_name', bossType)
    .maybeSingle()

  if (byNameError) {
    logger.error(
      { bossType, error: byNameError },
      'boss_mapping lookup by boss_name failed'
    )
  }

  if (byBossName) {
    lookup.set(bossType, {
      raid_boss: byBossName.boss_type,
      encounter_index: byBossName.encounter_index || 0
    })
    return lookup
  }

  const { data: byBossType, error: byTypeError } = await supabase
    .from('boss_mapping')
    .select('boss_type, boss_name, encounter_index')
    .ilike('boss_type', bossType)
    .eq('encounter_index', 0)
    .maybeSingle()

  if (byTypeError) {
    logger.error(
      { bossType, error: byTypeError },
      'boss_mapping lookup by boss_type failed'
    )
  }

  if (byBossType) {
    lookup.set(bossType, {
      raid_boss: byBossType.boss_type,
      encounter_index: 0
    })
    return lookup
  }

  lookup.set(bossType, { raid_boss: bossType, encounter_index: 0 })
  return lookup
}

function getEncounterIndex(
  lookup: BossMappingLookup,
  bossType: string
): number {
  const info = lookup.get(bossType)
  return info?.encounter_index ?? 0
}

function parseRoster(value: unknown): {
  roster: RosterInputEntry[] | null
  error?: string
} {
  return parseRosterPayload(value)
}

const normalizeBossToken = normalizeIdentifier

function buildBossTypeCandidates(
  primaryBossType: string,
  mappedBossType: string | null | undefined
): string[] {
  const candidates = new Set<string>()
  const add = (value: string | null | undefined) => {
    if (!value) return
    const normalized = value.trim()
    if (!normalized) return
    candidates.add(normalized)
  }

  add(primaryBossType)
  add(mappedBossType)
  return Array.from(candidates)
}

interface MetaAtlasDataRow {
  team_hash: string
  team_composition: string | null
  meta_team: string | null
  rarity_set: string | null
  sub_boss_name: string | null
  damage_p90: number | null
  damage_p75: number | null
  damage_max: number | null
  damage_avg: number | null
  attack_count: number | null
  season: string | null
}

function parseRaritySetRank(raritySet: string | null | undefined): number {
  if (!raritySet || raritySet.length < 2) return -1
  const rarity = raritySet.charAt(0).toUpperCase()
  const setNum = Number.parseInt(raritySet.slice(1), 10)
  if (!Number.isFinite(setNum)) return -1
  const rarityWeight =
    rarity === 'M' ? 30 : rarity === 'L' ? 20 : rarity === 'E' ? 10 : 0
  return rarityWeight + setNum
}

function filterHigherDifficultyRows(
  rows: MetaAtlasDataRow[],
  raritySet: string | null
): MetaAtlasDataRow[] {
  const currentRank = parseRaritySetRank(raritySet)
  if (currentRank < 0) return rows
  const filtered = rows.filter(
    (row) => parseRaritySetRank(row.rarity_set) >= currentRank
  )
  return filtered.length > 0 ? filtered : rows
}

function buildUniqueRecommendations(
  rows: MetaAtlasDataRow[],
  encounterIndex: number
): BossRecommendation[] {
  const uniqueTeams = new Map<string, BossRecommendation>()
  for (const row of rows) {
    const key = `${row.team_hash}-${row.rarity_set}-${row.sub_boss_name || 'main'}`
    if (!uniqueTeams.has(key)) {
      uniqueTeams.set(key, {
        team_hash: row.team_hash,
        team_composition: row.team_composition ?? '',
        meta_team: row.meta_team,
        rarity_set: row.rarity_set,
        sub_boss_name: row.sub_boss_name,
        encounter_index: encounterIndex,
        damage_p90: row.damage_p90 ?? 0,
        damage_p75: row.damage_p75 ?? 0,
        damage_max: row.damage_max ?? 0,
        damage_avg: row.damage_avg ?? 0,
        attack_count: row.attack_count ?? 0,
        season: row.season || ''
      })
    }
  }
  return Array.from(uniqueTeams.values())
}

async function queryMetaAtlasDataByBossType(
  supabase: TypedSupabaseClient,
  params: {
    rarity: string | null
    raritySet: string | null
    season: string | null
    minAttacks: number
    limit: number
  },
  bossTypeCandidates: string[],
  fuzzyMatch = false
): Promise<MetaAtlasDataRow[]> {
  const rowsByKey = new Map<string, MetaAtlasDataRow>()

  for (const bossCandidate of bossTypeCandidates) {
    let query = supabase
      .from('meta_atlas_data')
      .select(
        'team_hash, team_composition, meta_team, rarity_set, sub_boss_name, damage_p90, damage_p75, damage_max, damage_avg, attack_count, season'
      )
      .ilike('boss_type', fuzzyMatch ? `%${bossCandidate}%` : bossCandidate)
      .gte('attack_count', Number(params.minAttacks))

    if (params.raritySet) {
      query = query.eq('rarity_set', params.raritySet)
    } else if (params.rarity) {
      query = query.eq('rarity', params.rarity)
    }
    if (params.season) query = query.eq('season', params.season)

    const { data, error } = await query
      .order('damage_p90', { ascending: false })
      .limit(Number(params.limit) * 3)

    if (error) {
      logger.warn(
        {
          bossCandidate,
          fuzzyMatch,
          error
        },
        'meta_atlas_data query failed; skipping candidate'
      )
      continue
    }

    for (const row of (data as MetaAtlasDataRow[] | null) ?? []) {
      const key = `${row.team_hash}-${row.rarity_set}-${row.sub_boss_name || 'main'}-${row.season || ''}`
      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, row)
      }
    }
  }

  return Array.from(rowsByKey.values())
    .sort((a, b) => (b.damage_p90 || 0) - (a.damage_p90 || 0))
    .slice(0, Number(params.limit) * 3)
}

async function fetchRecommendations(
  supabase: TypedSupabaseClient,
  params: {
    bossType: string
    rarity: string | null
    raritySet: string | null
    season: string | null
    minAttacks: number
    limit: number
    allowLiveAggregation: boolean
  }
) {
  const bossMappings = await loadBossMappings(supabase, params.bossType)
  const mappedBossType = bossMappings.get(params.bossType)?.raid_boss
  const bossTypeCandidates = buildBossTypeCandidates(
    params.bossType,
    mappedBossType
  )

  // Exact alias match first; fuzzy fallback for mixed naming in stored rows.
  let data = await queryMetaAtlasDataByBossType(
    supabase,
    params,
    bossTypeCandidates,
    false
  )
  if (data.length === 0) {
    data = await queryMetaAtlasDataByBossType(
      supabase,
      params,
      bossTypeCandidates,
      true
    )
  }

  const encounterIndex = getEncounterIndex(bossMappings, params.bossType)

  if (data && data.length > 0) {
    const recommendations = buildUniqueRecommendations(data, encounterIndex)

    return {
      bossMappings,
      response: {
        boss_type: params.bossType,
        filters: {
          rarity: params.rarity,
          rarity_set: params.raritySet,
          season: params.season,
          min_attacks: Number(params.minAttacks)
        },
        count: recommendations.length,
        recommendations,
        source: 'meta_atlas_data' as const
      }
    }
  }

  // No exact rarity coverage: fall back to higher tiers of the same season.
  if (params.raritySet) {
    let relaxedRows = await queryMetaAtlasDataByBossType(
      supabase,
      {
        ...params,
        rarity: null,
        raritySet: null
      },
      bossTypeCandidates,
      false
    )
    if (relaxedRows.length === 0) {
      relaxedRows = await queryMetaAtlasDataByBossType(
        supabase,
        {
          ...params,
          rarity: null,
          raritySet: null
        },
        bossTypeCandidates,
        true
      )
    }

    if (relaxedRows.length > 0) {
      const higherRows = filterHigherDifficultyRows(
        relaxedRows,
        params.raritySet
      )
      const recommendations = buildUniqueRecommendations(
        higherRows,
        encounterIndex
      )
      const raritySets = Array.from(
        new Set(
          higherRows
            .map((row) => row.rarity_set)
            .filter(
              (value): value is string =>
                typeof value === 'string' && value.length > 0
            )
        )
      )

      return {
        bossMappings,
        response: {
          boss_type: params.bossType,
          filters: {
            rarity: params.rarity,
            rarity_set: params.raritySet,
            season: params.season,
            min_attacks: Number(params.minAttacks)
          },
          count: recommendations.length,
          recommendations,
          source: 'meta_atlas_data' as const,
          fallback_scope: 'higher_difficulty',
          fallback_rarity_sets: raritySets,
          notice:
            'Unable to find enough history for this exact boss at this Rarity/Set. Showing teams that performed on higher difficulty tiers for this boss.'
        }
      }
    }
  }

  if (!params.allowLiveAggregation) {
    return {
      bossMappings,
      response: {
        boss_type: params.bossType,
        filters: {
          rarity: params.rarity,
          rarity_set: params.raritySet,
          season: params.season,
          min_attacks: Number(params.minAttacks)
        },
        count: 0,
        recommendations: [],
        source: 'empty' as const,
        notice:
          'Unable to find any relevant history for this boss at this Rarity / Set.'
      }
    }
  }

  const seasons = params.season ? [params.season] : undefined
  const { data: liveData, error: liveError } = await supabase.rpc(
    'get_meta_atlas_anonymous',
    {
      p_min_attacks: Number(params.minAttacks),
      p_exclude_overkills: true,
      p_exclude_retreats: true,
      p_retreat_threshold: 10000,
      p_seasons: seasons
    }
  )

  if (liveError) {
    logger.error({ error: liveError }, 'Live aggregation error')
    return {
      bossMappings,
      response: {
        boss_type: params.bossType,
        filters: {
          rarity: params.rarity,
          rarity_set: params.raritySet,
          season: params.season,
          min_attacks: Number(params.minAttacks)
        },
        count: 0,
        recommendations: [],
        source: 'empty' as const
      }
    }
  }

  interface LiveDataRow {
    boss_type: string | null
    rarity_set: string | null
    rarity: string | null
    damage_p90: number | null
    team_hash: string | null
    team_composition: string | null
    meta_team: string | null
    sub_boss_name: string | null
    damage_p75: number | null
    damage_max: number | null
    damage_avg: number | null
    attack_count: number | null
    season: string | null
  }

  const normalizedCandidates = bossTypeCandidates
    .map((candidate) => normalizeBossToken(candidate))
    .filter((candidate) => candidate.length > 0)

  let filteredData = ((liveData as unknown as LiveDataRow[]) || []).filter(
    (row) => {
      const rowToken = normalizeBossToken(row.boss_type)
      if (!rowToken) return false
      return normalizedCandidates.some(
        (candidate) =>
          rowToken === candidate ||
          rowToken.includes(candidate) ||
          candidate.includes(rowToken)
      )
    }
  )

  if (params.raritySet) {
    filteredData = filteredData.filter(
      (row) => row.rarity_set === params.raritySet
    )
  } else if (params.rarity) {
    filteredData = filteredData.filter((row) => row.rarity === params.rarity)
  }

  filteredData.sort((a, b) => (b.damage_p90 || 0) - (a.damage_p90 || 0))
  filteredData = filteredData.slice(0, Number(params.limit) * 3)

  const uniqueTeams = new Map<string, BossRecommendation>()
  for (const row of filteredData) {
    const encounterIndex = getEncounterIndex(bossMappings, params.bossType)
    const key = `${row.team_hash}-${row.rarity_set}-${row.sub_boss_name || 'main'}`
    if (row.team_hash && !uniqueTeams.has(key)) {
      uniqueTeams.set(key, {
        team_hash: row.team_hash,
        team_composition: row.team_composition || '',
        meta_team: row.meta_team,
        rarity_set: row.rarity_set,
        sub_boss_name: row.sub_boss_name || null,
        encounter_index: encounterIndex,
        damage_p90: row.damage_p90 || 0,
        damage_p75: row.damage_p75 || 0,
        damage_max: row.damage_max || 0,
        damage_avg: row.damage_avg || 0,
        attack_count: Number(row.attack_count) || 0,
        season: row.season || ''
      })
    }
  }

  return {
    bossMappings,
    response: {
      boss_type: params.bossType,
      filters: {
        rarity: params.rarity,
        rarity_set: params.raritySet,
        season: params.season,
        min_attacks: Number(params.minAttacks)
      },
      count: uniqueTeams.size,
      recommendations: Array.from(uniqueTeams.values()),
      source: 'live_aggregation' as const
    }
  }
}

export const GET = withErrorHandler(async (request: Request) => {
  const authSupabase = await db()
  const {
    data: { user }
  } = await authSupabase.auth.getUser()
  if (!user) {
    throw Errors.fromResponse(401, { error: 'Authentication required' })
  }
  await assertUnbannedAuthUser(user)
  const access = await checkFeatureAccess(user.id, 'meta_atlas')
  if (!access.has_access) {
    throw Errors.fromResponse(403, {
      error: 'Meta Atlas feature access required',
      stage: access.stage,
      reason: access.reason
    })
  }

  const { searchParams } = new URL(request.url)
  const bossType = searchParams.get('boss_type')
  const rarity = searchParams.get('rarity')
  const raritySet = searchParams.get('rarity_set')
  const season = searchParams.get('season')
  const minAttacks = searchParams.get('min_attacks') || '20'
  const limit = searchParams.get('limit') || '20'
  const allowLiveAggregation = searchParams.get('allow_live') !== '0'

  if (!bossType) {
    throw Errors.fromResponse(400, { error: 'boss_type is required' })
  }

  const cacheKey = `meta_boss_recs:v1:${bossType}:${rarity ?? ''}:${raritySet ?? ''}:${season ?? ''}:${minAttacks}:${limit}:${allowLiveAggregation ? '1' : '0'}`
  const cached = await appCache.get<Record<string, unknown>>(cacheKey)
  if (cached !== null && cached !== undefined) {
    return NextResponse.json(cached)
  }

  try {
    const supabase = serviceDb()
    const resolvedMinAttacks = Number.isFinite(Number(minAttacks))
      ? Number(minAttacks)
      : 20
    const resolvedLimit = Number.isFinite(Number(limit)) ? Number(limit) : 20

    const { response } = await fetchRecommendations(supabase, {
      bossType,
      rarity,
      raritySet,
      season,
      minAttacks: resolvedMinAttacks,
      limit: resolvedLimit,
      allowLiveAggregation
    })

    await appCache.set(cacheKey, response, META_BOSS_RECS_TTL_SECONDS)
    return NextResponse.json(response)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Boss recommendations error')
    return NextResponse.json(
      {
        boss_type: bossType,
        filters: {
          rarity,
          rarity_set: raritySet,
          season,
          min_attacks: Number(minAttacks) || 20
        },
        count: 0,
        recommendations: [],
        source: 'empty'
      },
      { status: 200 }
    )
  }
})

export const POST = withErrorHandler(async (request: Request) => {
  const authSupabase = await db()
  const {
    data: { user }
  } = await authSupabase.auth.getUser()
  if (!user) {
    throw Errors.fromResponse(401, { error: 'Authentication required' })
  }
  await assertUnbannedAuthUser(user)
  const access = await checkFeatureAccess(user.id, 'meta_atlas')
  if (!access.has_access) {
    throw Errors.fromResponse(403, {
      error: 'Meta Atlas feature access required',
      stage: access.stage,
      reason: access.reason
    })
  }

  try {
    const body = await request.json()
    const bossType = body.boss_type ?? null
    const rarity = body.rarity ?? null
    const raritySet = body.rarity_set ?? null
    const season = body.season ?? null
    const minAttacks =
      typeof body.min_attacks === 'number' ? body.min_attacks : 20
    const limit = typeof body.limit === 'number' ? body.limit : 20
    const allowLiveAggregation = body.allow_live !== false
    const currentTeam = body.current_team ?? null
    const currentTeamHash = body.current_team_hash ?? null
    const encounterIndex =
      typeof body.encounter_index === 'number' ? body.encounter_index : null

    if (!bossType) {
      throw Errors.fromResponse(400, { error: 'boss_type is required' })
    }

    const { roster, error: rosterError } = parseRoster(body.roster)
    if (rosterError) {
      throw Errors.fromResponse(400, { error: rosterError })
    }

    const supabase = serviceDb()
    const { response: baseResponse } = await fetchRecommendations(supabase, {
      bossType,
      rarity,
      raritySet,
      season,
      minAttacks,
      limit,
      allowLiveAggregation
    })

    interface ProgressionResponse {
      boss_type: string
      filters: {
        rarity: string | null
        rarity_set: string | null
        season: string | null
        min_attacks: number
      }
      count: number
      recommendations: BossRecommendation[]
      source: 'meta_atlas_data' | 'live_aggregation' | 'empty'
      progression_error?: string
      current_team?: string | null
      current_team_info?: unknown
      target_team?: string | null
      target_team_info?: unknown
      upgrade_path?: unknown
      upgrade_paths?: unknown
      progression_path?: unknown
      total_damage_increase?: number
      final_team?: string | null
      meta_team_progressions?: unknown
      progression_message?: string
    }

    const response: ProgressionResponse = { ...baseResponse }

    if (currentTeam || currentTeamHash) {
      const progression = await resolveDagProgression(
        supabase,
        {
          bossType,
          encounterIndex,
          raritySet,
          season,
          currentTeam,
          currentTeamHash,
          roster,
          minAttacks
        },
        { requireCurrentTeam: false }
      )

      if ('error' in progression) {
        response.progression_error = progression.error
      } else {
        response.current_team = progression.current_team
        response.current_team_info = progression.current_team_info
        response.target_team = progression.target_team
        response.target_team_info = progression.target_team_info
        response.upgrade_path = progression.upgrade_path
        response.upgrade_paths = progression.upgrade_paths
        response.progression_path = progression.progression_path
        response.total_damage_increase = progression.total_damage_increase
        response.final_team = progression.final_team
        response.meta_team_progressions = progression.meta_team_progressions
        if (progression.message) {
          response.progression_message = progression.message
        }
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Boss recommendations POST error')
    throw Errors.fromResponse(500, { error: 'Failed to fetch recommendations' })
  }
})

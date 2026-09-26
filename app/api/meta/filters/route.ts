import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.filters')
import bossesConfig from '@/config/bosses.json'
import { getBossDisplayName as resolveCuratedBossName } from '@/app/lib/utils/bossNames'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { appCache } from '@tacticus/app-core/app-cache'

const META_FILTERS_TTL_SECONDS = 5 * 60
const META_FILTERS_CACHE_KEY = 'meta_filters:v1'

const unitIdToDisplayName = new Map<string, string>()
for (const boss of bossesConfig.bosses) {
  unitIdToDisplayName.set(boss.engineNameOrId.toLowerCase(), boss.displayName)
}

function getBossDisplayName(unitId: string, bossType: string): string {
  const displayName = unitIdToDisplayName.get(unitId.toLowerCase())
  if (displayName) {
    return displayName
  }
  // Maps reworked tokens ('BelisariusRW') that a bare CamelCase split would mangle.
  return resolveCuratedBossName(bossType)
}

export const dynamic = 'force-dynamic'
export const revalidate = 3600

const RARITY_SET_ORDER: Record<string, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
  L5: 5,
  M1: 10,
  M2: 11,
  M3: 12,
  M4: 13,
  M5: 14
}

type MetaAtlasRaritySetRow = {
  season: string
  rarity_set: string
}

type MetaAtlasRaritySetRpcClient = Omit<TypedSupabaseClient, 'rpc'> & {
  rpc: (name: 'get_meta_atlas_rarity_sets_by_season') => Promise<{
    data: MetaAtlasRaritySetRow[] | null
    error: unknown
  }>
}

function sortRaritySets(sets: Iterable<string>): string[] {
  return Array.from(new Set(sets))
    .filter(Boolean)
    .sort((a, b) => (RARITY_SET_ORDER[a] || 99) - (RARITY_SET_ORDER[b] || 99))
}

async function fetchRaritySetsBySeason(
  supabase: TypedSupabaseClient
): Promise<Record<string, string[]>> {
  // RPC may be ahead of generated types.
  try {
    const rpcClient = supabase as unknown as MetaAtlasRaritySetRpcClient
    const { data, error } = await rpcClient.rpc(
      'get_meta_atlas_rarity_sets_by_season'
    )

    if (!error && data) {
      const map: Record<string, Set<string>> = {}
      for (const row of data) {
        if (!row.season || !row.rarity_set) continue
        ;(map[row.season] ||= new Set()).add(row.rarity_set)
      }
      const result: Record<string, string[]> = {}
      for (const [season, sets] of Object.entries(map)) {
        result[season] = sortRaritySets(sets)
      }
      return result
    }
  } catch {
    // RPC missing or failed; use the table-scan fallback.
  }

  const { data: fallback } = await supabase
    .from('meta_atlas_data')
    .select('season, rarity_set')
    .not('season', 'is', null)
    .not('rarity_set', 'is', null)
    .order('season', { ascending: false })
    .limit(100000)

  const map: Record<string, Set<string>> = {}
  for (const row of fallback || []) {
    if (!row.season || !row.rarity_set) continue
    ;(map[row.season] ||= new Set()).add(row.rarity_set)
  }
  const result: Record<string, string[]> = {}
  for (const [season, sets] of Object.entries(map)) {
    result[season] = sortRaritySets(sets)
  }
  return result
}

async function fetchWithFallback(supabase: TypedSupabaseClient) {
  try {
    const [bossesResult, raritySetsResult, seasonsResult, metaTeamsResult] =
      await Promise.all([
        supabase.rpc('get_meta_atlas_distinct_bosses'),
        supabase.rpc('get_meta_atlas_distinct_rarity_sets'),
        supabase.rpc('get_meta_atlas_distinct_seasons'),
        supabase.rpc('get_meta_atlas_distinct_meta_teams')
      ])

    if (
      bossesResult.data &&
      raritySetsResult.data &&
      seasonsResult.data &&
      !bossesResult.error
    ) {
      return {
        bosses: (bossesResult.data as Array<{ boss_type: string }>).map(
          (r) => r.boss_type
        ),
        raritySets: (
          raritySetsResult.data as Array<{ rarity_set: string }>
        ).map((r) => r.rarity_set),
        seasons: (seasonsResult.data as Array<{ season: string }>).map(
          (r) => r.season
        ),
        metaTeams: (
          (metaTeamsResult.data || []) as Array<{ meta_team: string }>
        ).map((r) => r.meta_team)
      }
    }
  } catch {
    // RPC failed; use the fallback.
  }
  const { data: fallbackData } = await supabase
    .from('meta_atlas_data')
    .select('boss_type, rarity_set, meta_team, season')
    .limit(10000)

  const rawData = fallbackData || []

  return {
    bosses: Array.from(new Set(rawData.map((r) => r.boss_type)))
      .filter(Boolean)
      .sort() as string[],
    raritySets: sortRaritySets(
      rawData.map((r) => r.rarity_set).filter((rs): rs is string => Boolean(rs))
    ),
    seasons: Array.from(new Set(rawData.map((r) => r.season)))
      .filter((s): s is string => Boolean(s))
      .sort((a, b) => parseInt(b) - parseInt(a)),
    metaTeams: Array.from(new Set(rawData.map((r) => r.meta_team)))
      .filter(Boolean)
      .sort() as string[]
  }
}

export const GET = withErrorHandler(async () => {
  try {
    const cached = await appCache.get<Record<string, unknown>>(
      META_FILTERS_CACHE_KEY
    )
    if (cached !== null && cached !== undefined) {
      return NextResponse.json(cached)
    }

    const supabase = serviceDb()

    const [filterData, raritySetsBySeason] = await Promise.all([
      fetchWithFallback(supabase),
      fetchRaritySetsBySeason(supabase)
    ])
    const currentSeason = filterData.seasons[0] || null

    let currentSeasonBosses: Array<{
      boss_type: string
      boss_name: string
      boss_unit_id: string
    }> = []

    if (currentSeason) {
      const { data: seasonData } = await supabase
        .from('meta_atlas_data')
        .select('boss_type, boss_unit_id')
        .eq('season', currentSeason)
        .not('boss_unit_id', 'is', null)
        .limit(2000)

      if (seasonData) {
        const bossMap = new Map<
          string,
          { boss_type: string; boss_unit_id: string }
        >()
        const seenDisplayNames = new Set<string>()

        for (const b of seasonData) {
          if (!b.boss_unit_id) continue
          const normalizedUnitId = b.boss_unit_id.toLowerCase().trim()
          const displayName = getBossDisplayName(b.boss_unit_id, b.boss_type)

          if (
            !bossMap.has(normalizedUnitId) &&
            !seenDisplayNames.has(displayName)
          ) {
            bossMap.set(normalizedUnitId, {
              boss_type: b.boss_type,
              boss_unit_id: b.boss_unit_id
            })
            seenDisplayNames.add(displayName)
          }
        }

        currentSeasonBosses = Array.from(bossMap.values()).map((b) => ({
          boss_type: b.boss_type,
          boss_name: getBossDisplayName(b.boss_unit_id, b.boss_type),
          boss_unit_id: b.boss_unit_id
        }))
      }
    }

    // `rarity_sets` is the all-time superset; the by-season map lets the UI filter tiers.
    const responseBody = {
      bosses: filterData.bosses,
      current_season_bosses: currentSeasonBosses,
      rarity_sets: filterData.raritySets,
      rarity_sets_by_season: raritySetsBySeason,
      seasons: filterData.seasons,
      meta_teams: filterData.metaTeams,
      current_season: currentSeason,
      previous_season: filterData.seasons[1] || null,
      season_number: currentSeason ? parseInt(currentSeason, 10) : null
    }
    await appCache.set(
      META_FILTERS_CACHE_KEY,
      responseBody,
      META_FILTERS_TTL_SECONDS
    )
    return NextResponse.json(responseBody)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Meta filters error')
    throw Errors.fromResponse(500, { error: 'Failed to fetch meta filters' })
  }
})

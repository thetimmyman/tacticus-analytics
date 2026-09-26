import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.trends')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export interface MetaTrend {
  meta_team: string
  current_season: string
  previous_season: string
  current_avg_p90: number
  previous_avg_p90: number
  current_usage: number
  previous_usage: number
  damage_delta: number
  damage_delta_pct: number
  usage_delta: number
  usage_delta_pct: number
  trend: 'rising' | 'falling' | 'stable'
}

export interface OffMetaGem {
  team_hash: string
  team_composition: string
  meta_team: string | null
  boss_type: string
  rarity: string
  damage_p90: number
  attack_count: number
  efficiency_score: number
}

interface AggregatedData {
  meta_team: string | null
  damage_p90: number | null
  attack_count: number | null
}

function aggregateBySeason(data: AggregatedData[]) {
  const grouped: Record<
    string,
    { totalP90: number; count: number; usage: number }
  > = {}
  for (const row of data) {
    if (!row.meta_team || !row.damage_p90 || !row.attack_count) continue
    const key = row.meta_team
    const bucket =
      grouped[key] ?? (grouped[key] = { totalP90: 0, count: 0, usage: 0 })
    bucket.totalP90 += row.damage_p90
    bucket.count += 1
    bucket.usage += row.attack_count
  }
  return Object.fromEntries(
    Object.entries(grouped).map(([team, stats]) => [
      team,
      { avgP90: stats.totalP90 / stats.count, usage: stats.usage }
    ])
  )
}

async function fetchSeasonData(
  supabase: TypedSupabaseClient,
  season: string,
  minAttacks: number,
  raritySet: string | null,
  rarity: string | null
): Promise<AggregatedData[]> {
  let query = supabase
    .from('meta_atlas_data')
    .select('meta_team, damage_p90, attack_count')
    .eq('season', season)
    .gte('attack_count', minAttacks)
    .not('meta_team', 'is', null)

  if (raritySet) {
    query = query.eq('rarity_set', raritySet)
  } else if (rarity) {
    query = query.eq('rarity', rarity)
  }

  const { data, error } = await query
  if (error) throw error

  if (data && data.length > 0) {
    return data
  }

  const { data: liveData, error: liveError } = await supabase.rpc(
    'get_meta_atlas_anonymous',
    {
      p_min_attacks: minAttacks,
      p_exclude_overkills: true,
      p_exclude_retreats: true,
      p_retreat_threshold: 10000,
      p_seasons: [season]
    }
  )

  if (liveError) {
    logger.error({ season, error: liveError }, 'Live aggregation error')
    return []
  }

  interface LiveDataRow {
    rarity_set: string | null
    rarity: string | null
    meta_team: string | null
    damage_p90: number | null
    attack_count: number | null
  }

  let filtered = (liveData as unknown as LiveDataRow[]) || []
  if (raritySet) {
    filtered = filtered.filter((row) => row.rarity_set === raritySet)
  } else if (rarity) {
    filtered = filtered.filter((row) => row.rarity === rarity)
  }

  return filtered.map((row) => ({
    meta_team: row.meta_team,
    damage_p90: row.damage_p90,
    attack_count: row.attack_count ? Number(row.attack_count) : null
  }))
}

export const GET = withErrorHandler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const currentSeason = searchParams.get('current_season')
  const previousSeason = searchParams.get('previous_season')
  const rarity = searchParams.get('rarity')
  const raritySet = searchParams.get('rarity_set')
  const minAttacks = parseInt(searchParams.get('min_attacks') || '30')

  if (!currentSeason || !previousSeason) {
    throw Errors.fromResponse(400, {
      error: 'current_season and previous_season are required'
    })
  }

  try {
    const supabase = serviceDb()

    const [currentData, previousData] = await Promise.all([
      fetchSeasonData(supabase, currentSeason, minAttacks, raritySet, rarity),
      fetchSeasonData(supabase, previousSeason, minAttacks, raritySet, rarity)
    ])

    const currentAgg = aggregateBySeason(currentData)
    const previousAgg = aggregateBySeason(previousData)

    const allTeams = new Set([
      ...Object.keys(currentAgg),
      ...Object.keys(previousAgg)
    ])
    const trends: MetaTrend[] = []

    for (const team of allTeams) {
      const current = currentAgg[team]
      const previous = previousAgg[team]

      if (!current && !previous) continue

      const currentAvgP90 = current?.avgP90 || 0
      const previousAvgP90 = previous?.avgP90 || 0
      const currentUsage = current?.usage || 0
      const previousUsage = previous?.usage || 0

      const damageDelta = currentAvgP90 - previousAvgP90
      const damageDeltaPct =
        previousAvgP90 > 0
          ? ((currentAvgP90 - previousAvgP90) / previousAvgP90) * 100
          : currentAvgP90 > 0
            ? 100
            : 0
      const usageDelta = currentUsage - previousUsage
      const usageDeltaPct =
        previousUsage > 0
          ? ((currentUsage - previousUsage) / previousUsage) * 100
          : currentUsage > 0
            ? 100
            : 0

      let trend: 'rising' | 'falling' | 'stable' = 'stable'
      if (damageDeltaPct > 5 || usageDeltaPct > 10) trend = 'rising'
      else if (damageDeltaPct < -5 || usageDeltaPct < -10) trend = 'falling'

      trends.push({
        meta_team: team,
        current_season: currentSeason,
        previous_season: previousSeason,
        current_avg_p90: Math.round(currentAvgP90),
        previous_avg_p90: Math.round(previousAvgP90),
        current_usage: currentUsage,
        previous_usage: previousUsage,
        damage_delta: Math.round(damageDelta),
        damage_delta_pct: Math.round(damageDeltaPct),
        usage_delta: usageDelta,
        usage_delta_pct: Math.round(usageDeltaPct),
        trend
      })
    }

    trends.sort((a, b) => b.damage_delta_pct - a.damage_delta_pct)

    let offMetaQuery = supabase
      .from('meta_atlas_data')
      .select(
        'team_hash, team_composition, meta_team, boss_type, rarity, rarity_set, damage_p90, attack_count'
      )
      .eq('season', currentSeason)
      .gte('attack_count', 10)
      .lt('attack_count', 50)
      .order('damage_p90', { ascending: false })
      .limit(100)

    if (raritySet) {
      offMetaQuery = offMetaQuery.eq('rarity_set', raritySet)
    } else if (rarity) {
      offMetaQuery = offMetaQuery.eq('rarity', rarity)
    }

    const { data: offMetaData, error: offMetaError } = await offMetaQuery

    const offMetaGems: OffMetaGem[] = []
    if (!offMetaError && offMetaData) {
      for (const row of offMetaData) {
        if (!row.damage_p90 || !row.attack_count) continue
        const efficiencyScore = row.damage_p90 / Math.log2(row.attack_count + 1)
        offMetaGems.push({
          team_hash: row.team_hash,
          team_composition: row.team_composition || '',
          meta_team: row.meta_team,
          boss_type: row.boss_type,
          rarity: row.rarity || '',
          damage_p90: row.damage_p90,
          attack_count: row.attack_count,
          efficiency_score: Math.round(efficiencyScore)
        })
      }
      offMetaGems.sort((a, b) => b.efficiency_score - a.efficiency_score)
    }

    return NextResponse.json({
      current_season: currentSeason,
      previous_season: previousSeason,
      rarity,
      rarity_set: raritySet,
      trends,
      rising_stars: trends.filter((t) => t.trend === 'rising').slice(0, 10),
      falling_off: trends.filter((t) => t.trend === 'falling').slice(0, 10),
      off_meta_gems: offMetaGems.slice(0, 15)
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Meta trends error')
    throw Errors.fromResponse(500, { error: 'Failed to fetch meta trends' })
  }
})

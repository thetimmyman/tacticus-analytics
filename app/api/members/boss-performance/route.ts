import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.members.boss-performance')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'

interface BossPerformanceRow {
  display_name: string
  boss_name: string
  encounter_id: number
  set_num: number
  tier: number
  rarity: string
  battle_count: number | null
  player_vs_guild_avg: number | null
  player_vs_cluster_avg: number | null
  boss_preference: string | null
}

interface PlayerBossPerformance {
  boss_name: string
  display_key: string
  encounter_id: number
  set_num: number
  tier: number
  rarity: string
  player_vs_guild_avg: number
  player_vs_cluster_avg: number
  preference: string
}

interface BossAggregateAccumulator {
  display_name: string
  boss_name: string
  encounter_id: number
  set_num: number
  rarity: string
  preference: string
  battle_count_total: number
  weighted_guild_sum: number
  weighted_cluster_sum: number
  fallback_guild_sum: number
  fallback_cluster_sum: number
  fallback_count: number
}

const PREFERENCE_PRIORITY: Record<string, number> = {
  preferred: 3,
  avoid: 2,
  neutral: 1
}

export const GET = withErrorHandler(async (request: Request) => {
  // Outside the try, whose catch would turn the gate's 401 into a 500.
  const { profile } = await requireActiveMembershipForApi()

  const { searchParams } = new URL(request.url)
  const guild = searchParams.get('guild')
  const season = searchParams.get('season')

  if (!guild || !season) {
    throw Errors.validation('Missing required parameters: guild, season')
  }

  // guild_code may be a lowercase UUID. Stricter than token-usage (same-cluster officers).
  const callerGuild = normalizeGuildIdentifier(profile.guild_code)
  if (!callerGuild || callerGuild !== normalizeGuildIdentifier(guild)) {
    throw Errors.forbidden('Access denied for this guild')
  }

  try {
    logger.info({ guildCode: guild, season }, 'Boss performance API called')

    const supabase = await db()

    // The caller's own normalized code, never the query param, reaches the RPC.
    const rpcResult = await supabase.rpc('get_player_boss_performance', {
      guild_code_param: callerGuild,
      season_param: season
    })
    const data = rpcResult.data as BossPerformanceRow[] | null
    const error = rpcResult.error

    if (error) {
      logger.error({ err: error }, 'RPC error:')
      throw Errors.database('Unable to load boss performance data', {
        endpoint: '/api/members/boss-performance',
        guild,
        season
      })
    }

    const rows: BossPerformanceRow[] = Array.isArray(data) ? data : []

    logger.info(`RPC returned ${rows.length} records`)

    // One row per boss/encounter (battle-weighted).
    const aggregates = new Map<string, BossAggregateAccumulator>()

    rows.forEach((row) => {
      const aggKey = `${row.display_name}|${row.rarity}|${row.set_num}|${row.encounter_id}|${row.boss_name}`
      const battleCount = row.battle_count ?? 0
      const guildPct = row.player_vs_guild_avg ?? 0
      const clusterPct = row.player_vs_cluster_avg ?? 0
      const preference = row.boss_preference ?? 'neutral'

      const existing = aggregates.get(aggKey)
      if (existing) {
        existing.battle_count_total += battleCount
        existing.weighted_guild_sum += guildPct * battleCount
        existing.weighted_cluster_sum += clusterPct * battleCount
        existing.fallback_guild_sum += guildPct
        existing.fallback_cluster_sum += clusterPct
        existing.fallback_count += 1
        if (
          (PREFERENCE_PRIORITY[preference] ?? 0) >
          (PREFERENCE_PRIORITY[existing.preference] ?? 0)
        ) {
          existing.preference = preference
        }
      } else {
        aggregates.set(aggKey, {
          display_name: row.display_name,
          boss_name: row.boss_name,
          encounter_id: row.encounter_id,
          set_num: row.set_num,
          rarity: row.rarity,
          preference,
          battle_count_total: battleCount,
          weighted_guild_sum: guildPct * battleCount,
          weighted_cluster_sum: clusterPct * battleCount,
          fallback_guild_sum: guildPct,
          fallback_cluster_sum: clusterPct,
          fallback_count: 1
        })
      }
    })

    const playerPerformanceMap = new Map<string, PlayerBossPerformance[]>()

    aggregates.forEach((agg) => {
      const rarityPrefix = agg.rarity === 'Mythic' ? 'M' : 'L'
      const setDisplay = agg.set_num + 1
      const cleanBossName = agg.boss_name.replace(/_(?:Legendary|Mythic)$/, '')
      // cleanBossName already holds the prime's character name.
      const displayKey =
        agg.encounter_id === 0
          ? `${rarityPrefix}${setDisplay} ${getBossDisplayName(cleanBossName)}`
          : `${rarityPrefix}${setDisplay} ${cleanBossName}`

      const useWeighted = agg.battle_count_total > 0
      const guildAvg = useWeighted
        ? agg.weighted_guild_sum / agg.battle_count_total
        : agg.fallback_count > 0
          ? agg.fallback_guild_sum / agg.fallback_count
          : 0
      const clusterAvg = useWeighted
        ? agg.weighted_cluster_sum / agg.battle_count_total
        : agg.fallback_count > 0
          ? agg.fallback_cluster_sum / agg.fallback_count
          : 0

      const performances = playerPerformanceMap.get(agg.display_name) ?? []
      performances.push({
        boss_name: agg.boss_name,
        display_key: displayKey,
        encounter_id: agg.encounter_id,
        set_num: agg.set_num,
        tier: 0,
        rarity: agg.rarity,
        player_vs_guild_avg: Math.round(guildAvg * 100) / 100,
        player_vs_cluster_avg: Math.round(clusterAvg * 100) / 100,
        preference: agg.preference
      })
      playerPerformanceMap.set(agg.display_name, performances)
    })

    logger.info(
      `Boss performance API returning data for ${playerPerformanceMap.size} players`
    )

    return NextResponse.json(Object.fromEntries(playerPerformanceMap))
  } catch (error: unknown) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Boss performance API error:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      endpoint: '/api/members/boss-performance'
    })
  }
})

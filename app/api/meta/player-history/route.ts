import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { getUserAccessLevels } from '@/app/lib/services/feature-release-service'
import { requireFeatureAccess } from '@/app/lib/services/feature-access-gate'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.player-history')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'

interface SeasonPerformance {
  season: string
  boss_type: string
  avg_damage: number
  total_damage: number
  total_attacks: number
  best_damage: number
}

interface SeasonSummary {
  season: string
  total_damage: number
  total_attacks: number
  avg_damage_per_attack: number
  bosses_fought: number
  best_boss: string | null
  best_boss_damage: number
}

interface TrendData {
  direction: 'improving' | 'declining' | 'stable'
  change_pct: number
  cagr: number
  cagr_periods: number
  regression_r2: number
  trendline_points: number[]
  has_enough_data: boolean
}

function calculateCAGR(values: number[]): { cagr: number; periods: number } {
  const validValues = values.filter((v) => v > 0)
  if (validValues.length < 2) {
    return { cagr: 0, periods: 0 }
  }
  const startValue = validValues[validValues.length - 1]
  const endValue = validValues[0]
  const safeStart = startValue ?? 0
  const safeEnd = endValue ?? 0
  const periods = validValues.length - 1
  if (safeStart <= 0 || periods <= 0) {
    return { cagr: 0, periods }
  }
  const cagr = (Math.pow(safeEnd / safeStart, 1 / periods) - 1) * 100
  return { cagr: Math.round(cagr * 10) / 10, periods }
}

function calculateLinearRegression(yValues: number[]): {
  r2: number
  trendlinePoints: number[]
} {
  if (yValues.length < 2) {
    return { r2: 0, trendlinePoints: [] }
  }
  const n = yValues.length
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0
  for (let i = 0; i < n; i++) {
    sumX += i
    const value = yValues[i] ?? 0
    sumY += value
    sumXY += i * value
    sumX2 += i * i
  }
  const denominator = n * sumX2 - sumX * sumX
  if (denominator === 0) {
    const avg = sumY / n
    return { r2: 0, trendlinePoints: yValues.map(() => Math.round(avg)) }
  }
  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n
  const trendlinePoints = yValues.map((_, i) =>
    Math.round(slope * i + intercept)
  )
  const meanY = sumY / n
  let ssRes = 0,
    ssTot = 0
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept
    const value = yValues[i] ?? 0
    ssRes += (value - predicted) ** 2
    ssTot += (value - meanY) ** 2
  }
  const r2 = ssTot > 0 ? Math.round((1 - ssRes / ssTot) * 100) / 100 : 0
  return { r2, trendlinePoints }
}

export const GET = withErrorHandler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const playerName = searchParams.get('player_name')
  const guildCode = searchParams.get('guild_code')
  const limit = parseInt(searchParams.get('limit') || '10')

  if (!playerName || !guildCode) {
    throw Errors.fromResponse(400, {
      error: 'player_name and guild_code are required'
    })
  }

  try {
    const authSupabase = await db()
    const user = await requireSessionUser(authSupabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    const accessLevels = await getUserAccessLevels(user.id)
    if (accessLevels.guild_code !== guildCode && !accessLevels.is_app_admin) {
      throw Errors.fromResponse(403, {
        error: 'You can only view player history for your own guild'
      })
    }

    await requireFeatureAccess(
      user.id,
      'meta_atlas',
      'Meta Atlas feature access required'
    )

    const supabase = serviceDb()

    // "Season" is TEXT and sorts lexically.
    const { data: seasonData, error: queryError } = await supabase
      .from('EOT_GR_data')
      .select('Season, Name, damageDealt')
      .eq('displayName', playerName)
      .eq('Guild', guildCode)
      .in('damageType', ['Battle', 'Bomb'])
      .not('Season', 'is', null)
      .order('season_num', { ascending: false })

    if (queryError) {
      logger.error(
        { playerName, guildCode, error: queryError },
        'Player history query error'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to fetch player history',
        details: queryError.message
      })
    }

    if (!seasonData || seasonData.length === 0) {
      return NextResponse.json({
        player_name: playerName,
        guild_code: guildCode,
        seasons: [],
        boss_breakdown: [],
        trends: {
          direction: 'stable',
          change_pct: 0,
          cagr: 0,
          cagr_periods: 0,
          regression_r2: 0,
          trendline_points: [],
          has_enough_data: false
        } as TrendData,
        message: 'No historical data found for this player'
      })
    }

    const seasonBossMap = new Map<
      string,
      Map<string, { damages: number[]; total: number }>
    >()

    for (const row of seasonData) {
      const season = String(row.Season)
      const boss = row.Name || 'Unknown'
      const damage = row.damageDealt || 0

      if (!seasonBossMap.has(season)) {
        seasonBossMap.set(season, new Map())
      }
      const bossMap = seasonBossMap.get(season)!
      if (!bossMap.has(boss)) {
        bossMap.set(boss, { damages: [], total: 0 })
      }
      const bossData = bossMap.get(boss)!
      bossData.damages.push(damage)
      bossData.total += damage
    }

    const bossBreakdown: SeasonPerformance[] = []
    const seasonSummaries: SeasonSummary[] = []

    const sortedSeasons = Array.from(seasonBossMap.keys())
      .sort((a, b) => parseInt(b) - parseInt(a))
      .slice(0, limit)

    for (const season of sortedSeasons) {
      const bossMap = seasonBossMap.get(season)!
      let seasonTotalDamage = 0
      let seasonTotalAttacks = 0
      let bestBoss: string | null = null
      let bestBossDamage = 0

      for (const [boss, data] of bossMap) {
        const avgDamage =
          data.damages.length > 0 ? data.total / data.damages.length : 0
        const maxDamage = Math.max(...data.damages, 0)

        bossBreakdown.push({
          season,
          boss_type: boss,
          avg_damage: Math.round(avgDamage),
          total_damage: Math.round(data.total),
          total_attacks: data.damages.length,
          best_damage: Math.round(maxDamage)
        })

        seasonTotalDamage += data.total
        seasonTotalAttacks += data.damages.length

        if (data.total > bestBossDamage) {
          bestBossDamage = data.total
          bestBoss = boss
        }
      }

      seasonSummaries.push({
        season,
        total_damage: Math.round(seasonTotalDamage),
        total_attacks: seasonTotalAttacks,
        avg_damage_per_attack:
          seasonTotalAttacks > 0
            ? Math.round(seasonTotalDamage / seasonTotalAttacks)
            : 0,
        bosses_fought: bossMap.size,
        best_boss: bestBoss,
        best_boss_damage: Math.round(bestBossDamage)
      })
    }

    let trendDirection: 'improving' | 'declining' | 'stable' = 'stable'
    let trendChangePct = 0

    if (seasonSummaries.length >= 2) {
      const recent = seasonSummaries[0]
      const previous = seasonSummaries[1]

      if (recent && previous && previous.avg_damage_per_attack > 0) {
        trendChangePct =
          ((recent.avg_damage_per_attack - previous.avg_damage_per_attack) /
            previous.avg_damage_per_attack) *
          100
        trendDirection =
          trendChangePct > 5
            ? 'improving'
            : trendChangePct < -5
              ? 'declining'
              : 'stable'
      }
    }

    const avgDamageValues = [...seasonSummaries]
      .reverse()
      .map((s) => s.avg_damage_per_attack)
    const { cagr, periods: cagrPeriods } = calculateCAGR(avgDamageValues)
    const { r2, trendlinePoints } = calculateLinearRegression(avgDamageValues)

    const trends: TrendData = {
      direction: trendDirection,
      change_pct: Math.round(trendChangePct * 10) / 10,
      cagr,
      cagr_periods: cagrPeriods,
      regression_r2: r2,
      trendline_points: trendlinePoints,
      has_enough_data: seasonSummaries.length >= 3
    }

    return NextResponse.json({
      player_name: playerName,
      guild_code: guildCode,
      seasons: seasonSummaries,
      boss_breakdown: bossBreakdown,
      trends
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ playerName, guildCode, error }, 'Player history error')
    throw Errors.fromResponse(500, { error: 'Failed to fetch player history' })
  }
})

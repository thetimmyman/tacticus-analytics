import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { getUserAccessLevels } from '@/app/lib/services/feature-release-service'
import { requireFeatureAccess } from '@/app/lib/services/feature-access-gate'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.performance-gaps')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'

interface PerformanceGap {
  boss_type: string
  rarity: string
  team_composition: string
  team_hash: string
  player_avg_damage: number
  meta_avg_damage: number
  meta_p90_damage: number
  gap_percentage: number
  improvement_potential: number
  attack_count: number
}

interface TeamPerformance {
  boss_type: string
  rarity: string
  team_composition: string
  team_hash: string
  player_avg_damage: number
  meta_avg_damage: number
  meta_p75_damage: number
  meta_p90_damage: number
  percentile: number
  tier:
    | 'elite'
    | 'excellent'
    | 'above_average'
    | 'average'
    | 'below_average'
    | 'needs_improvement'
  attack_count: number
  vs_average_pct: number
}

interface PlayerTeamUsage {
  boss_type: string
  rarity: string
  team_hash: string
  team_composition: string
  attack_count: number
  avg_damage: number
}

function getTier(percentile: number): TeamPerformance['tier'] {
  if (percentile >= 95) return 'elite'
  if (percentile >= 90) return 'excellent'
  if (percentile >= 75) return 'above_average'
  if (percentile >= 50) return 'average'
  if (percentile >= 25) return 'below_average'
  return 'needs_improvement'
}

function estimatePercentile(
  playerDamage: number,
  metaAvg: number,
  metaP75: number,
  metaP90: number
): number {
  if (playerDamage >= metaP90) {
    const ratio = (playerDamage - metaP90) / (metaP90 * 0.2)
    return Math.min(99, 90 + ratio * 9)
  }
  if (playerDamage >= metaP75) {
    const ratio = (playerDamage - metaP75) / (metaP90 - metaP75)
    return 75 + ratio * 15
  }
  if (playerDamage >= metaAvg) {
    const ratio = (playerDamage - metaAvg) / (metaP75 - metaAvg)
    return 50 + ratio * 25
  }
  const ratio = playerDamage / metaAvg
  return Math.max(1, ratio * 50)
}

export const GET = withErrorHandler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const playerName = searchParams.get('player_name')
  const guildCode = searchParams.get('guild_code')
  const season = searchParams.get('season')
  const minAttacks = parseInt(searchParams.get('min_attacks') || '3')
  const minGapPct = parseFloat(searchParams.get('min_gap_pct') || '10')
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
        error: 'You can only view performance gaps for your own guild'
      })
    }

    await requireFeatureAccess(
      user.id,
      'meta_atlas',
      'Meta Atlas feature access required'
    )

    const supabase = serviceDb()

    const { data: playerTeams, error: playerError } = await supabase.rpc(
      'get_player_team_usage',
      {
        p_player_name: playerName,
        p_guild_code: guildCode,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_season: season as any
      }
    )

    if (playerError) {
      logger.error(
        { playerName, guildCode, error: playerError },
        'Player teams error'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to fetch player team usage',
        details: playerError.message
      })
    }

    if (!playerTeams || playerTeams.length === 0) {
      return NextResponse.json({
        player_name: playerName,
        guild_code: guildCode,
        gaps: [],
        all_teams: [],
        summary: {
          teams_analyzed: 0,
          gaps_found: 0,
          total_improvement_potential: 0,
          overall_percentile: null,
          overall_tier: null,
          tier_distribution: {
            elite: 0,
            excellent: 0,
            above_average: 0,
            average: 0,
            below_average: 0,
            needs_improvement: 0
          },
          top_performers: [],
          watch_list: []
        },
        message: 'No battle data found for this player'
      })
    }

    const gaps: PerformanceGap[] = []
    const allTeams: TeamPerformance[] = []
    const tierCounts = {
      elite: 0,
      excellent: 0,
      above_average: 0,
      average: 0,
      below_average: 0,
      needs_improvement: 0
    }
    let teamsSkippedLowAttacks = 0
    let teamsNoMetaMatch = 0

    const eligibleTeams = (playerTeams as PlayerTeamUsage[]).filter((t) => {
      if (t.attack_count < minAttacks) {
        teamsSkippedLowAttacks++
        return false
      }
      return true
    })

    const teamHashes = [...new Set(eligibleTeams.map((t) => t.team_hash))]

    interface MetaDataRow {
      team_hash: string
      boss_type: string
      rarity: string
      damage_avg: number | null
      damage_p75: number | null
      damage_p90: number | null
      attack_count: number | null
    }

    const { data: metaDataBatch } = await supabase
      .from('meta_atlas_data')
      .select(
        'team_hash, boss_type, rarity, damage_avg, damage_p75, damage_p90, attack_count'
      )
      .in('team_hash', teamHashes)
      .gte('attack_count', 20)

    const metaLookup = new Map<string, MetaDataRow>()
    for (const row of (metaDataBatch || []) as MetaDataRow[]) {
      const key = `${row.team_hash}::${row.boss_type}::${row.rarity}`
      metaLookup.set(key, row)
    }

    for (const playerTeam of eligibleTeams) {
      const key = `${playerTeam.team_hash}::${playerTeam.boss_type}::${playerTeam.rarity}`
      const metaData = metaLookup.get(key)

      if (!metaData) {
        teamsNoMetaMatch++
        continue
      }

      const metaAvg = metaData.damage_avg ?? 0
      const metaP75 = metaData.damage_p75 ?? metaAvg * 1.15
      const metaP90 = metaData.damage_p90 ?? metaAvg * 1.3

      if (metaAvg === 0) continue

      const percentile = estimatePercentile(
        playerTeam.avg_damage,
        metaAvg,
        metaP75,
        metaP90
      )
      const tier = getTier(percentile)
      const vsAveragePct = ((playerTeam.avg_damage - metaAvg) / metaAvg) * 100

      tierCounts[tier]++

      const teamPerf: TeamPerformance = {
        boss_type: playerTeam.boss_type,
        rarity: playerTeam.rarity,
        team_composition: playerTeam.team_composition,
        team_hash: playerTeam.team_hash,
        player_avg_damage: Math.round(playerTeam.avg_damage),
        meta_avg_damage: Math.round(metaAvg),
        meta_p75_damage: Math.round(metaP75),
        meta_p90_damage: Math.round(metaP90),
        percentile: Math.round(percentile),
        tier,
        attack_count: playerTeam.attack_count,
        vs_average_pct: Math.round(vsAveragePct * 10) / 10
      }

      allTeams.push(teamPerf)

      const gapPct = ((metaAvg - playerTeam.avg_damage) / metaAvg) * 100

      if (gapPct >= minGapPct) {
        gaps.push({
          boss_type: playerTeam.boss_type,
          rarity: playerTeam.rarity,
          team_composition: playerTeam.team_composition,
          team_hash: playerTeam.team_hash,
          player_avg_damage: Math.round(playerTeam.avg_damage),
          meta_avg_damage: Math.round(metaAvg),
          meta_p90_damage: Math.round(metaP90),
          gap_percentage: Math.round(gapPct * 10) / 10,
          improvement_potential: Math.round(metaAvg - playerTeam.avg_damage),
          attack_count: playerTeam.attack_count
        })
      }
    }

    gaps.sort((a, b) => b.gap_percentage - a.gap_percentage)
    allTeams.sort((a, b) => b.percentile - a.percentile)

    const topGaps = gaps.slice(0, limit)
    const totalImprovement = topGaps.reduce(
      (sum, g) => sum + g.improvement_potential,
      0
    )

    const totalTeams = allTeams.length
    const overallPercentile =
      totalTeams > 0
        ? Math.round(
            allTeams.reduce((sum, t) => sum + t.percentile, 0) / totalTeams
          )
        : null
    const overallTier =
      overallPercentile !== null ? getTier(overallPercentile) : null

    const topPerformers = allTeams.filter((t) => t.percentile >= 75).slice(0, 5)
    const watchList = allTeams
      .filter((t) => t.vs_average_pct >= -10 && t.vs_average_pct < 0)
      .slice(0, 3)

    return NextResponse.json({
      player_name: playerName,
      guild_code: guildCode,
      season: season || 'current',
      gaps: topGaps,
      all_teams: allTeams,
      summary: {
        teams_analyzed: (playerTeams as PlayerTeamUsage[]).length,
        teams_with_meta_data: totalTeams,
        teams_skipped_low_attacks: teamsSkippedLowAttacks,
        teams_no_meta_match: teamsNoMetaMatch,
        gaps_found: gaps.length,
        total_improvement_potential: totalImprovement,
        overall_percentile: overallPercentile,
        overall_tier: overallTier,
        tier_distribution: tierCounts,
        top_performers: topPerformers,
        watch_list: watchList
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ playerName, guildCode, error }, 'Performance gaps error')
    throw Errors.fromResponse(500, {
      error: 'Failed to analyze performance gaps'
    })
  }
})

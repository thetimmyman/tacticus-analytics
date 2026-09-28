'use client'

import { formatNumber } from '@tacticus/app-core/formatters'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import {
  TrendingUp,
  AlertTriangle,
  Target,
  Zap,
  Trophy,
  Star,
  Eye,
  ChevronUp,
  ChevronDown
} from 'lucide-react'
import clsx from 'clsx'
import { useState } from 'react'

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

type PerformanceTier =
  | 'elite'
  | 'excellent'
  | 'above_average'
  | 'average'
  | 'below_average'
  | 'needs_improvement'

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
  tier: PerformanceTier
  attack_count: number
  vs_average_pct: number
}

interface TierDistribution {
  elite: number
  excellent: number
  above_average: number
  average: number
  below_average: number
  needs_improvement: number
}

interface PerformanceGapCardProps {
  gap: PerformanceGap
  rank?: number
  showTeamDetails?: boolean
  className?: string
}

function getGapSeverity(gapPct: number): {
  color: string
  bg: string
  label: string
} {
  if (gapPct >= 30)
    return {
      color: 'text-red-400',
      bg: 'bg-red-500/10 border-red-500/30',
      label: 'Significant Gap'
    }
  if (gapPct >= 20)
    return {
      color: 'text-orange-400',
      bg: 'bg-orange-500/10 border-orange-500/30',
      label: 'Moderate Gap'
    }
  if (gapPct >= 10)
    return {
      color: 'text-yellow-400',
      bg: 'bg-yellow-500/10 border-yellow-500/30',
      label: 'Minor Gap'
    }
  return {
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/30',
    label: 'Within Range'
  }
}

export function PerformanceGapCard({
  gap,
  rank,
  showTeamDetails = true,
  className
}: PerformanceGapCardProps) {
  const severity = getGapSeverity(gap.gap_percentage)
  const damageToP90 = gap.meta_p90_damage - gap.player_avg_damage

  return (
    <div className={clsx('rounded-lg border p-4', severity.bg, className)}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {rank && (
            <div className="w-6 h-6 rounded-full bg-(--card-bg) flex items-center justify-center text-xs font-bold text-white">
              {rank}
            </div>
          )}
          <div>
            <div className="font-semibold text-white">
              {getBossDisplayName(gap.boss_type)}
            </div>
            <div className="text-xs text-secondary-wh40k">{gap.rarity}</div>
          </div>
        </div>
        <div className={clsx('text-sm font-semibold', severity.color)}>
          {gap.gap_percentage.toFixed(0)}% gap
        </div>
      </div>

      {showTeamDetails && (
        <div
          className="text-xs text-secondary-wh40k mb-3 truncate"
          title={gap.team_composition}
        >
          {gap.team_composition}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-secondary-wh40k flex items-center gap-1">
            <Target className="w-3 h-3" />
            Your Average
          </span>
          <span className="text-white font-medium">
            {formatNumber(gap.player_avg_damage)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-secondary-wh40k flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Meta Average
          </span>
          <span className="text-blue-400 font-medium">
            {formatNumber(gap.meta_avg_damage)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-secondary-wh40k flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Meta P90
          </span>
          <span className="text-purple-400 font-medium">
            {formatNumber(gap.meta_p90_damage)}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-white/10">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className={clsx('w-4 h-4 mt-0.5 shrink-0', severity.color)}
          />
          <div className="text-xs">
            <span className="text-secondary-wh40k">
              Improvement potential:{' '}
            </span>
            <span className={severity.color}>
              +{formatNumber(gap.improvement_potential)}
            </span>
            <span className="text-secondary-wh40k ml-1">to reach average</span>
            {damageToP90 > 0 && (
              <>
                <br />
                <span className="text-secondary-wh40k">To reach P90: </span>
                <span className="text-purple-400">
                  +{formatNumber(damageToP90)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 text-xs text-secondary-wh40k text-right">
        Based on {gap.attack_count} attack{gap.attack_count !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

interface PerformanceGapSummaryProps {
  gaps: PerformanceGap[]
  playerName: string
  totalImprovementPotential: number
  overallPercentile?: number | null
  overallTier?: PerformanceTier | null
  tierDistribution?: TierDistribution
  topPerformers?: TeamPerformance[]
  watchList?: TeamPerformance[]
  teamsWithMetaData?: number
  teamsAnalyzed?: number
  teamsSkippedLowAttacks?: number
  teamsNoMetaMatch?: number
  className?: string
}

const tierConfig: Record<
  PerformanceTier,
  { label: string; color: string; bg: string; icon: typeof Trophy }
> = {
  elite: {
    label: 'Elite',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/20 border-yellow-500/40',
    icon: Trophy
  },
  excellent: {
    label: 'Excellent',
    color: 'text-purple-400',
    bg: 'bg-purple-500/20 border-purple-500/40',
    icon: Star
  },
  above_average: {
    label: 'Above Average',
    color: 'text-blue-400',
    bg: 'bg-blue-500/20 border-blue-500/40',
    icon: TrendingUp
  },
  average: {
    label: 'Average',
    color: 'text-primary-wh40k',
    bg: 'bg-gray-500/20 border-gray-500/40',
    icon: Target
  },
  below_average: {
    label: 'Below Average',
    color: 'text-orange-400',
    bg: 'bg-orange-500/20 border-orange-500/40',
    icon: AlertTriangle
  },
  needs_improvement: {
    label: 'Needs Work',
    color: 'text-red-400',
    bg: 'bg-red-500/20 border-red-500/40',
    icon: AlertTriangle
  }
}

function TierBadge({
  tier,
  percentile
}: {
  tier: PerformanceTier
  percentile: number
}) {
  const config = tierConfig[tier]
  const Icon = config.icon
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-medium',
        config.bg,
        config.color
      )}
    >
      <Icon className="w-4 h-4" />
      <span>{config.label}</span>
      <span className="opacity-70">• Top {100 - percentile}%</span>
    </div>
  )
}

function TierDistributionBar({
  distribution,
  total
}: {
  distribution: TierDistribution
  total: number
}) {
  if (total === 0) return null

  const segments = [
    { key: 'elite', count: distribution.elite, color: 'bg-yellow-500' },
    { key: 'excellent', count: distribution.excellent, color: 'bg-purple-500' },
    {
      key: 'above_average',
      count: distribution.above_average,
      color: 'bg-blue-500'
    },
    { key: 'average', count: distribution.average, color: 'bg-gray-500' },
    {
      key: 'below_average',
      count: distribution.below_average,
      color: 'bg-orange-500'
    },
    {
      key: 'needs_improvement',
      count: distribution.needs_improvement,
      color: 'bg-red-500'
    }
  ].filter((s) => s.count > 0)

  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-700">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={clsx(seg.color, 'transition-all')}
            style={{ width: `${(seg.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((seg) => {
          const label =
            seg.key === 'above_average'
              ? 'Above Avg'
              : seg.key === 'below_average'
                ? 'Below Avg'
                : seg.key === 'needs_improvement'
                  ? 'Needs Work'
                  : seg.key.charAt(0).toUpperCase() + seg.key.slice(1)
          return (
            <div key={seg.key} className="flex items-center gap-1">
              <div className={clsx('w-2 h-2 rounded-full', seg.color)} />
              <span className="text-secondary-wh40k">{label}:</span>
              <span className="text-white">{seg.count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TopPerformerCard({
  team,
  rank
}: {
  team: TeamPerformance
  rank: number
}) {
  const config = tierConfig[team.tier]
  return (
    <div className={clsx('rounded-lg border p-3', config.bg)}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-(--card-bg) flex items-center justify-center text-xs font-bold text-white">
            {rank}
          </div>
          <div>
            <div className="font-medium text-white text-sm">
              {getBossDisplayName(team.boss_type)}
            </div>
            <div className="text-xs text-secondary-wh40k">{team.rarity}</div>
          </div>
        </div>
        <div className={clsx('text-sm font-semibold', config.color)}>
          Top {100 - team.percentile}%
        </div>
      </div>
      <div
        className="text-xs text-secondary-wh40k truncate"
        title={team.team_composition}
      >
        {team.team_composition}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-secondary-wh40k">
          Your avg: {formatNumber(team.player_avg_damage)}
        </span>
        <span
          className={clsx(
            team.vs_average_pct >= 0 ? 'text-green-400' : 'text-red-400'
          )}
        >
          {team.vs_average_pct >= 0 ? '+' : ''}
          {team.vs_average_pct.toFixed(1)}% vs meta
        </span>
      </div>
    </div>
  )
}

function WatchListCard({ team }: { team: TeamPerformance }) {
  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Eye className="w-4 h-4 text-orange-400" />
        <span className="font-medium text-white text-sm">
          {getBossDisplayName(team.boss_type)}
        </span>
        <span className="text-xs text-secondary-wh40k">({team.rarity})</span>
      </div>
      <div
        className="text-xs text-secondary-wh40k truncate mb-2"
        title={team.team_composition}
      >
        {team.team_composition}
      </div>
      <div className="text-xs text-orange-400">
        {team.vs_average_pct.toFixed(1)}% below average - close to gap threshold
      </div>
    </div>
  )
}

export function PerformanceGapSummary({
  gaps,
  playerName,
  totalImprovementPotential,
  overallPercentile,
  overallTier,
  tierDistribution,
  topPerformers,
  watchList,
  teamsWithMetaData,
  teamsAnalyzed,
  teamsSkippedLowAttacks,
  teamsNoMetaMatch,
  className
}: PerformanceGapSummaryProps) {
  const [showDetails, setShowDetails] = useState(true)
  const significantGaps = gaps.filter((g) => g.gap_percentage >= 20).length
  const hasSignificantGaps = significantGaps > 0
  const hasEnhancedData =
    overallPercentile !== null && overallPercentile !== undefined

  if (!hasEnhancedData) {
    return (
      <div
        className={clsx(
          'rounded-lg border p-4',
          hasSignificantGaps
            ? 'bg-orange-500/10 border-orange-500/30'
            : 'bg-green-500/10 border-green-500/30',
          className
        )}
      >
        <div className="flex items-center gap-3">
          {hasSignificantGaps ? (
            <AlertTriangle className="w-8 h-8 text-orange-400" />
          ) : (
            <Target className="w-8 h-8 text-green-400" />
          )}
          <div>
            <div className="font-semibold text-white">
              {hasSignificantGaps
                ? `${significantGaps} significant gap${significantGaps !== 1 ? 's' : ''} found`
                : 'Performing well!'}
            </div>
            <div className="text-sm text-secondary-wh40k">
              {hasSignificantGaps
                ? `Total improvement potential: +${formatNumber(totalImprovementPotential)} damage`
                : `${playerName} is performing within expected ranges`}
            </div>
            {(teamsAnalyzed !== undefined ||
              teamsNoMetaMatch !== undefined) && (
              <div className="text-xs text-secondary-wh40k mt-2">
                {teamsAnalyzed !== undefined && (
                  <span>Teams found: {teamsAnalyzed}</span>
                )}
                {teamsSkippedLowAttacks !== undefined &&
                  teamsSkippedLowAttacks > 0 && (
                    <span className="ml-2">
                      • Skipped (low attacks): {teamsSkippedLowAttacks}
                    </span>
                  )}
                {teamsNoMetaMatch !== undefined && teamsNoMetaMatch > 0 && (
                  <span className="ml-2">
                    • No meta data: {teamsNoMetaMatch}
                  </span>
                )}
                {teamsWithMetaData !== undefined && (
                  <span className="ml-2">• Matched: {teamsWithMetaData}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const tier = overallTier || 'average'
  const config = tierConfig[tier]

  return (
    <div className={clsx('rounded-lg border', config.bg, className)}>
      <div
        className="p-4 cursor-pointer"
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={clsx(
                'w-12 h-12 rounded-full flex items-center justify-center',
                config.bg
              )}
            >
              <config.icon className={clsx('w-6 h-6', config.color)} />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="font-semibold text-white text-lg">
                  {playerName}
                </span>
                <TierBadge tier={tier} percentile={overallPercentile} />
              </div>
              <div className="text-sm text-secondary-wh40k">
                {teamsWithMetaData} team{teamsWithMetaData !== 1 ? 's' : ''}{' '}
                analyzed against meta data
                {hasSignificantGaps && (
                  <span className="text-orange-400 ml-2">
                    • {significantGaps} gap{significantGaps !== 1 ? 's' : ''}{' '}
                    found
                  </span>
                )}
              </div>
            </div>
          </div>
          <button className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            {showDetails ? (
              <ChevronUp className="w-5 h-5 text-secondary-wh40k" />
            ) : (
              <ChevronDown className="w-5 h-5 text-secondary-wh40k" />
            )}
          </button>
        </div>
      </div>

      {showDetails && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-4">
          {tierDistribution && teamsWithMetaData && teamsWithMetaData > 0 && (
            <div>
              <h4 className="text-sm font-medium text-white mb-2">
                Performance Distribution
              </h4>
              <TierDistributionBar
                distribution={tierDistribution}
                total={teamsWithMetaData}
              />
            </div>
          )}

          {topPerformers && topPerformers.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-400" />
                Top Performers
              </h4>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {topPerformers.slice(0, 3).map((team, i) => (
                  <TopPerformerCard
                    key={team.team_hash}
                    team={team}
                    rank={i + 1}
                  />
                ))}
              </div>
            </div>
          )}

          {watchList && watchList.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
                <Eye className="w-4 h-4 text-orange-400" />
                Watch List
                <span className="text-xs text-secondary-wh40k font-normal">
                  Teams approaching gap threshold
                </span>
              </h4>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {watchList.map((team) => (
                  <WatchListCard key={team.team_hash} team={team} />
                ))}
              </div>
            </div>
          )}

          {hasSignificantGaps && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0" />
              <div className="text-sm">
                <span className="text-orange-400 font-medium">
                  Improvement opportunity:{' '}
                </span>
                <span className="text-white">
                  +{formatNumber(totalImprovementPotential)} potential damage
                </span>
                <span className="text-secondary-wh40k">
                  {' '}
                  from addressing {significantGaps} gap
                  {significantGaps !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

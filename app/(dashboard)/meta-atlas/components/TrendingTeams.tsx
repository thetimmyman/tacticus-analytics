'use client'

import { formatNumber } from '@tacticus/app-core/formatters'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { TrendingUp, TrendingDown, Star, Sparkles } from 'lucide-react'
import clsx from 'clsx'

interface MetaTrend {
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

interface OffMetaGem {
  team_hash: string
  team_composition: string
  meta_team: string | null
  boss_type: string
  rarity: string
  damage_p90: number
  attack_count: number
  efficiency_score: number
}

interface TrendingTeamCardProps {
  trend: MetaTrend
  type: 'rising' | 'falling'
}

export function TrendingTeamCard({ trend, type }: TrendingTeamCardProps) {
  const isRising = type === 'rising'
  const Icon = isRising ? TrendingUp : TrendingDown
  const colorClass = isRising ? 'text-green-400' : 'text-red-400'
  const bgClass = isRising
    ? 'bg-green-500/10 border-green-500/30'
    : 'bg-red-500/10 border-red-500/30'

  return (
    <div className={clsx('rounded-lg border p-3 sm:p-4', bgClass)}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-white text-sm sm:text-base">
          {trend.meta_team}
        </span>
        <span
          className={clsx(
            'text-xs sm:text-sm font-medium flex items-center gap-1',
            colorClass
          )}
        >
          <Icon className="w-3 h-3 sm:w-4 sm:h-4" />
          {isRising ? '+' : ''}
          {trend.damage_delta_pct}%
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2 text-[10px] sm:text-xs">
        <div>
          <div className="text-[var(--text-secondary)]">P90 Damage</div>
          <div className="text-white font-medium">
            {formatNumber(trend.current_avg_p90)}
          </div>
        </div>
        <div>
          <div className="text-[var(--text-secondary)]">Usage</div>
          <div className="text-white font-medium">
            {formatNumber(trend.current_usage)} attacks
          </div>
        </div>
        <div>
          <div className="text-[var(--text-secondary)]">Previous P90</div>
          <div className="text-[var(--text-secondary)]">
            {formatNumber(trend.previous_avg_p90)}
          </div>
        </div>
        <div>
          <div className="text-[var(--text-secondary)]">Usage Change</div>
          <div
            className={
              trend.usage_delta >= 0 ? 'text-green-400' : 'text-red-400'
            }
          >
            {trend.usage_delta >= 0 ? '+' : ''}
            {trend.usage_delta_pct}%
          </div>
        </div>
      </div>
    </div>
  )
}

interface OffMetaGemCardProps {
  gem: OffMetaGem
  rank: number
}

export function OffMetaGemCard({ gem, rank }: OffMetaGemCardProps) {
  return (
    <div className="rounded-lg border bg-amber-500/10 border-amber-500/30 p-3 sm:p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
            <Sparkles className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-400" />
          </div>
          <div>
            <div className="font-semibold text-white text-xs sm:text-sm">
              {gem.meta_team || 'Custom Team'}
            </div>
            <div className="text-[10px] sm:text-xs text-[var(--text-secondary)]">
              {getBossDisplayName(gem.boss_type)}
            </div>
          </div>
        </div>
        <span className="text-[10px] sm:text-xs text-amber-400 font-medium">
          #{rank}
        </span>
      </div>
      <div
        className="text-[10px] sm:text-xs text-[var(--text-secondary)] mb-2 truncate"
        title={gem.team_composition}
      >
        {gem.team_composition}
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-[10px] sm:text-xs">
        <div>
          <div className="text-[var(--text-secondary)]">P90</div>
          <div className="text-purple-400 font-medium">
            {formatNumber(gem.damage_p90)}
          </div>
        </div>
        <div>
          <div className="text-[var(--text-secondary)]">Attacks</div>
          <div className="text-white">{gem.attack_count}</div>
        </div>
        <div>
          <div className="text-[var(--text-secondary)]">Efficiency</div>
          <div className="text-amber-400">
            {formatNumber(gem.efficiency_score)}
          </div>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-white/10 text-[10px] sm:text-xs text-amber-300/70">
        Low usage, high damage - hidden value!
      </div>
    </div>
  )
}

interface TrendingTeamsGridProps {
  risingStars: MetaTrend[]
  fallingOff: MetaTrend[]
  offMetaGems: OffMetaGem[]
  showOffMeta?: boolean
}

export function TrendingTeamsGrid({
  risingStars,
  fallingOff,
  offMetaGems,
  showOffMeta = true
}: TrendingTeamsGridProps) {
  return (
    <div className="space-y-6">
      {risingStars.length > 0 && (
        <div>
          <h3 className="text-sm sm:text-md font-semibold text-green-400 flex items-center gap-2 mb-2 sm:mb-3">
            <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
            Rising Stars
          </h3>
          <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {risingStars.map((trend) => (
              <TrendingTeamCard
                key={trend.meta_team}
                trend={trend}
                type="rising"
              />
            ))}
          </div>
        </div>
      )}

      {fallingOff.length > 0 && (
        <div>
          <h3 className="text-sm sm:text-md font-semibold text-red-400 flex items-center gap-2 mb-2 sm:mb-3">
            <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4" />
            Falling Off
          </h3>
          <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {fallingOff.map((trend) => (
              <TrendingTeamCard
                key={trend.meta_team}
                trend={trend}
                type="falling"
              />
            ))}
          </div>
        </div>
      )}

      {showOffMeta && offMetaGems.length > 0 && (
        <div>
          <h3 className="text-sm sm:text-md font-semibold text-amber-400 flex items-center gap-2 mb-2 sm:mb-3">
            <Star className="w-3 h-3 sm:w-4 sm:h-4" />
            Off-Meta Gems
            <span className="text-[10px] sm:text-xs text-[var(--text-secondary)] font-normal">
              (high damage, low usage)
            </span>
          </h3>
          <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {offMetaGems.slice(0, 6).map((gem, i) => (
              <OffMetaGemCard key={gem.team_hash} gem={gem} rank={i + 1} />
            ))}
          </div>
        </div>
      )}

      {risingStars.length === 0 && fallingOff.length === 0 && (
        <div className="text-center py-8 text-[var(--text-secondary)]">
          Not enough data to show meta trends between these seasons.
        </div>
      )}
    </div>
  )
}

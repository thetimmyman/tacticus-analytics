'use client'

import { Card } from '@tacticus/ui-kit'
import { formatDamage, formatNumber } from '@tacticus/app-core/formatters'
import { useBossTopStats } from '@/app/components/boss-performance/hooks/useBossPerformanceData'

export function BossStatsHighlights() {
  const { topStats, loading, error } = useBossTopStats()
  const hasStats =
    topStats.topTotalDamage > 0 ||
    topStats.biggestHit > 0 ||
    topStats.totalBossTokens > 0 ||
    topStats.totalPrimeTokens > 0

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
        {['total-damage', 'single-hit', 'boss-tokens', 'prime-tokens'].map(
          (statType) => (
            <Card
              key={`top-stat-skeleton-${statType}`}
              className="stat-card-wh40k p-3 sm:p-4 animate-pulse"
            >
              <div className="h-3 w-24 rounded bg-[color-mix(in_srgb,var(--card-border)_70%,transparent)]" />
              <div className="mt-2 h-6 w-20 rounded bg-[color-mix(in_srgb,var(--card-border)_70%,transparent)]" />
              <div className="mt-2 h-3 w-16 rounded bg-[color-mix(in_srgb,var(--card-border)_50%,transparent)]" />
            </Card>
          )
        )}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="card-wh40k p-4 text-sm text-red-300">
        Unable to show boss stats right now. Please try again shortly.
      </Card>
    )
  }

  if (!hasStats) {
    return (
      <Card className="card-wh40k p-4 text-sm text-[var(--text-secondary)]">
        No boss performance stats are available for the current filters yet.
      </Card>
    )
  }
  const cards = [
    {
      label: 'Top Total Damage',
      value: formatDamage(topStats.topTotalDamage),
      helper: topStats.topTotalDamagePlayer,
      tone: 'glow-primary'
    },
    {
      label: 'Top Single Hit',
      value: formatDamage(topStats.biggestHit, 2),
      helper: topStats.biggestHitPlayer,
      tone: 'glow-accent',
      emphasis: true
    },
    {
      label: 'Total Boss Tokens',
      value: formatNumber(topStats.totalBossTokens),
      helper: ''
    },
    {
      label: 'Total Prime Tokens',
      value: formatNumber(topStats.totalPrimeTokens),
      helper: '',
      emphasis: true
    }
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
      {cards.map((card) => (
        <Card
          key={card.label}
          className={`stat-card-wh40k p-2 sm:p-3 md:p-4 ${card.tone ?? ''}`}
        >
          <div className="stat-label-wh40k text-[10px] sm:text-xs">
            {card.label}
          </div>
          <div
            className={`stat-value-wh40k text-sm sm:text-lg md:text-xl lg:text-2xl font-bold leading-tight ${card.emphasis ? 'text-[var(--accent)]' : ''}`}
          >
            {card.value}
          </div>
          {card.helper && (
            <div
              className="text-[9px] sm:text-[10px] md:text-xs text-secondary-wh40k truncate"
              title={card.helper}
            >
              {card.helper}
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

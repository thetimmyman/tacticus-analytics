'use client'

import type { ReactNode } from 'react'
import { BossLink } from '@/app/components/ui/BossLink'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { MechanicusEmptyState as EmptyState } from '@tacticus/ui-kit/loading'
import { BoxWhiskerPlot } from '@/app/components/boss-performance/BoxWhiskerPlot'
import type { BoxWhiskerStats } from '@/app/components/boss-performance/boxWhiskerUtils'
import { formatNumber } from '@tacticus/app-core/formatters'
import { useBossDistributions } from '@/app/components/boss-performance/hooks/useBossPerformanceData'

export function BossDamageDistributions() {
  const {
    bossName,
    mainDistribution,
    primeDamageDistributions,
    hasPrimeData,
    primeParticipantCount,
    loading,
    error
  } = useBossDistributions()
  const distributionCards: {
    key: string
    title: ReactNode
    stats: BoxWhiskerStats
    color: string
    minHeight: number
  }[] = []

  if (mainDistribution) {
    distributionCards.push({
      key: 'main',
      stats: mainDistribution,
      color: 'var(--accent)',
      minHeight: 140,
      title: (
        <div className="flex items-center gap-2 text-[var(--accent)]">
          {bossName && bossName !== 'TempBoss' ? (
            <BossLink
              bossName={bossName}
              showPortrait
              portraitSize="small"
              portraitVariant="portrait"
              className="flex items-center gap-2"
            >
              {bossName}
            </BossLink>
          ) : (
            <span>Main Boss Damage Distribution</span>
          )}
          {bossName && bossName !== 'TempBoss' && (
            <span className="text-xs font-normal text-[var(--text-secondary)]">
              Damage Distribution
            </span>
          )}
        </div>
      )
    })
  }

  primeDamageDistributions.forEach((distribution) => {
    distributionCards.push({
      key: `prime-${distribution.name}`,
      stats: distribution,
      color: '#A855F7',
      minHeight: 130,
      title: (
        <div className="flex items-center gap-2 text-purple-300">
          <BossLink
            bossName={distribution.name}
            showPortrait
            portraitSize="small"
            portraitVariant="portrait"
            className="flex items-center gap-2"
          >
            {distribution.name}
          </BossLink>
          <span className="text-xs font-normal text-[var(--text-secondary)]">
            Damage Distribution
          </span>
        </div>
      )
    })
  })

  const hasDistributions = distributionCards.length > 0

  if (loading && !hasDistributions) {
    return (
      <section className="space-y-4">
        <DistributionSkeletonGrid />
      </section>
    )
  }

  if (error && !hasDistributions) {
    return (
      <section className="space-y-4">
        <EmptyState
          title="Damage distributions unavailable"
          description="We couldn’t load the damage distribution stats for the selected filters. Try refreshing the page or adjust your selections."
        />
      </section>
    )
  }

  const gridClasses = [
    'grid grid-cols-1 gap-3 sm:gap-4 md:gap-6',
    distributionCards.length >= 2 ? 'sm:grid-cols-2' : '',
    distributionCards.length >= 3 ? 'lg:grid-cols-3' : '',
    distributionCards.length >= 4 ? 'xl:grid-cols-4' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className="space-y-4">
      {hasDistributions ? (
        <div className={gridClasses}>
          {distributionCards.map((card) => (
            <Card
              key={card.key}
              className="card-wh40k p-3 sm:p-4 flex flex-col h-full"
            >
              <CardHeader className="p-0 pb-2 sm:pb-3">
                <CardTitle className="subheading-wh40k text-sm sm:text-base md:text-lg">
                  {card.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                <BoxWhiskerPlot
                  stats={card.stats}
                  color={card.color}
                  minHeight={card.minHeight}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No damage distributions yet"
          description="Once more battles are logged for the selected boss and filters, the damage distribution plots will appear here."
        />
      )}

      {hasPrimeData && primeDamageDistributions.length === 0 && (
        <EmptyState
          title="Prime distributions processing"
          description="Prime battles are still being processed for the current filters. Check back soon for distribution insights."
        />
      )}

      {primeDamageDistributions.length > 0 && (
        <div className="text-xs text-[var(--text-secondary)] text-right pr-1">
          Tracking {formatNumber(primeParticipantCount)} prime participants
          across {primeDamageDistributions.length} bosses.
        </div>
      )}
    </section>
  )
}

function DistributionSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
      {['left', 'right'].map((position) => (
        <Card
          key={`distribution-skeleton-${position}`}
          className="card-wh40k p-4 flex flex-col h-full"
        >
          <CardHeader className="p-0 pb-3">
            <CardTitle className="subheading-wh40k text-base sm:text-lg">
              <span className="inline-block h-4 w-48 animate-pulse rounded bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            <div className="h-48 w-full animate-pulse rounded bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

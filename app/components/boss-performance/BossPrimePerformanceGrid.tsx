'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { BossLink } from '@/app/components/ui/BossLink'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatDamage } from '@tacticus/app-core/formatters'
import { usePrimeBossStats } from '@/app/components/boss-performance/hooks/useBossPerformanceData'

export function BossPrimePerformanceGrid() {
  const { primeBossStats, loading, error } = usePrimeBossStats()
  const hasPrimes = primeBossStats.length > 0

  if (error) {
    return (
      <Card className="card-wh40k p-4 text-sm text-red-300">
        Unable to render prime boss statistics right now. Please try again.
      </Card>
    )
  }

  if (loading && !hasPrimes) {
    return <PrimeGridSkeleton />
  }

  if (!loading && !hasPrimes) {
    return (
      <Card className="card-wh40k p-4 text-sm text-secondary-wh40k">
        Prime boss battles have not been recorded for these filters yet.
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
      {primeBossStats.map((primeBoss) => (
        <Card key={primeBoss.bossName} className="card-wh40k overflow-hidden">
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="subheading-wh40k text-(--accent) flex items-center gap-2 sm:gap-3">
              <BossLink
                bossName={primeBoss.bossName}
                showPortrait
                portraitSize="medium"
                portraitVariant="portrait"
                className="flex items-center gap-1 sm:gap-2"
              >
                {primeBoss.bossName}
              </BossLink>
              <span className="text-sm sm:text-base">Performance</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            <div className="space-y-2 max-h-64 overflow-y-auto pr-2 sm:pr-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-(--card-bg) [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full">
              {primeBoss.playerStats.slice(0, 10).map((player, index) => {
                const maxAvgDamage = Math.max(
                  ...primeBoss.playerStats.map((p) => p.avgDamage),
                  0
                )
                const barWidth =
                  maxAvgDamage > 0
                    ? Math.min(100, (player.avgDamage / maxAvgDamage) * 100)
                    : 0

                return (
                  <div
                    key={player.displayName}
                    className="flex items-start sm:items-center gap-2"
                  >
                    <span className="text-xs text-secondary-wh40k w-4 mt-1 sm:mt-0">
                      #{index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-1 gap-1 sm:gap-2">
                        <span className="text-xs font-medium text-secondary-wh40k truncate">
                          <PlayerLink playerName={player.displayName}>
                            {player.displayName}
                          </PlayerLink>
                        </span>
                        <div className="text-right hidden sm:flex sm:items-center gap-2">
                          <span className="text-xs text-secondary-wh40k">
                            {player.tokenCount} tokens
                          </span>
                          <span className="text-xs font-mono text-(--accent)">
                            Avg: {formatDamage(player.avgDamage)}
                          </span>
                          <span className="text-xs font-mono text-secondary-wh40k">
                            Max: {formatDamage(player.maxHit)}
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-(--card-bg) rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-linear-to-r from-(--accent) to-purple-400 transition-all duration-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {primeBoss.playerStats.length > 10 && (
              <div className="text-xs text-secondary-wh40k text-center mt-2">
                Showing top 10 of {primeBoss.playerStats.length} players
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function PrimeGridSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
      {['left', 'right'].map((position) => (
        <Card
          key={`prime-grid-skeleton-${position}`}
          className="card-wh40k overflow-hidden"
        >
          <CardHeader className="p-4 pb-2">
            <CardTitle className="subheading-wh40k text-base sm:text-lg">
              <span className="inline-block h-5 w-48 animate-pulse rounded-sm bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-2">
              {['row-1', 'row-2', 'row-3', 'row-4', 'row-5'].map((rowId) => (
                <div
                  key={`prime-grid-${position}-${rowId}`}
                  className="flex items-center gap-2 animate-pulse"
                >
                  <span className="h-3 w-4 rounded-sm bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 rounded-sm bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
                    <div className="h-2 rounded-sm bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

'use client'

import type { ReactNode } from 'react'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from '@tacticus/ui-kit'
import { formatDamage } from '@tacticus/app-core/formatters'
import type { PlayerBossStats } from '@/app/components/boss-performance/types'
import { useBossRankings } from '@/app/components/boss-performance/hooks/useBossPerformanceData'

export function BossRankingsPanel() {
  const {
    playerBossStats,
    avgDamagePage,
    totalDamagePage,
    setAvgDamagePage,
    setTotalDamagePage,
    playersPerPage,
    loading,
    error
  } = useBossRankings()

  const totalPages = Math.max(
    1,
    Math.ceil(playerBossStats.length / playersPerPage)
  )
  const maxTotalDamage = Math.max(
    ...playerBossStats.map((p) => p.totalDamage),
    0
  )
  const hasPlayers = playerBossStats.length > 0

  if (error) {
    return (
      <Card className="card-wh40k p-4 text-sm text-red-300">
        Unable to load player rankings at the moment. Please try again shortly.
      </Card>
    )
  }

  if (loading && !hasPlayers) {
    return <RankingsSkeleton />
  }

  if (!loading && !hasPlayers) {
    return (
      <Card className="card-wh40k p-4 text-sm text-[var(--text-secondary)]">
        No player damage data is available for these filters yet.
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
      <RankingCard
        title="Player AVG Boss Damage"
        playerBossStats={playerBossStats}
        sortKey="avgDamage"
        page={avgDamagePage}
        onPageChange={setAvgDamagePage}
        playersPerPage={playersPerPage}
        totalPages={totalPages}
        renderMetrics={(player) => (
          <>
            <span className="text-[var(--text-secondary)]">
              {player.tokenCount} tok
            </span>
            <span className="font-mono text-[var(--accent)]">
              Avg: {formatDamage(player.avgDamage)}
            </span>
            <span className="font-mono text-[var(--text-secondary)]">
              Max: {formatDamage(player.maxHit)}
            </span>
          </>
        )}
        getBarWidth={(player) =>
          player.maxHit > 0
            ? Math.min(100, (player.avgDamage / player.maxHit) * 100)
            : 0
        }
      />

      <RankingCard
        title="Total Damage Output Rankings"
        playerBossStats={playerBossStats}
        sortKey="totalDamage"
        page={totalDamagePage}
        onPageChange={setTotalDamagePage}
        playersPerPage={playersPerPage}
        totalPages={totalPages}
        renderMetrics={(player) => (
          <>
            <span className="text-[var(--text-secondary)]">
              {player.tokenCount} tok
            </span>
            <span className="font-mono text-green-400">
              Total: {formatDamage(player.totalDamage)}
            </span>
          </>
        )}
        getBarWidth={(player) =>
          maxTotalDamage > 0
            ? Math.min(100, (player.totalDamage / maxTotalDamage) * 100)
            : 0
        }
      />
    </div>
  )
}

function RankingsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
      {['avg-damage', 'total-damage'].map((cardType) => (
        <Card
          key={`ranking-skeleton-${cardType}`}
          className="card-wh40k overflow-hidden"
        >
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="subheading-wh40k text-base sm:text-lg animate-pulse">
              <span className="inline-block h-4 w-40 rounded bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            <div className="space-y-3">
              {['row-1', 'row-2', 'row-3', 'row-4', 'row-5'].map((rowId) => (
                <div
                  key={`ranking-skeleton-${cardType}-${rowId}`}
                  className="flex items-center gap-3 animate-pulse"
                >
                  <span className="h-3 w-4 rounded bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 rounded bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
                    <div className="h-2 rounded bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
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

type SortKey = 'avgDamage' | 'totalDamage'

interface RankingCardProps {
  title: string
  playerBossStats: PlayerBossStats[]
  sortKey: SortKey
  page: number
  onPageChange: (page: number) => void
  playersPerPage: number
  totalPages: number
  renderMetrics: (player: PlayerBossStats) => ReactNode
  getBarWidth: (
    player: PlayerBossStats,
    playersOnPage: PlayerBossStats[]
  ) => number
}

function RankingCard({
  title,
  playerBossStats,
  sortKey,
  page,
  onPageChange,
  playersPerPage,
  totalPages,
  renderMetrics,
  getBarWidth
}: RankingCardProps) {
  const sortedPlayers = [...playerBossStats].sort(
    (a, b) => b[sortKey] - a[sortKey]
  )
  const startIndex = page * playersPerPage
  const endIndex = startIndex + playersPerPage
  const playersToShow = sortedPlayers.slice(startIndex, endIndex)
  const safePage = Math.min(page, totalPages - 1)

  const handlePrev = () => onPageChange(Math.max(0, safePage - 1))
  const handleNext = () => onPageChange(Math.min(totalPages - 1, safePage + 1))

  return (
    <Card className="card-wh40k overflow-hidden">
      <CardHeader className="p-3 sm:p-4 pb-2">
        <CardTitle className="subheading-wh40k text-base sm:text-lg">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 pt-0">
        <div className="space-y-2 max-h-64 overflow-y-auto pr-2 sm:pr-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[var(--card-bg)] [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full">
          {playersToShow.map((player, index) => {
            const actualRank = startIndex + index + 1
            const barWidth = getBarWidth(player, playersToShow)

            return (
              <div
                key={`${player.displayName}-${sortKey}`}
                className="flex items-start gap-2"
              >
                <span className="text-[10px] sm:text-xs text-[var(--text-secondary)] w-4 sm:w-6 mt-0.5">
                  #{actualRank}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1 gap-2">
                    <span className="text-xs font-medium text-[var(--text-secondary)] truncate flex-shrink">
                      {player.displayName}
                    </span>
                    <div className="flex items-center gap-2 text-[9px] sm:text-[10px] flex-shrink-0">
                      {renderMetrics(player)}
                    </div>
                  </div>
                  <div className="w-full bg-[var(--card-bg)] rounded-full h-1.5 sm:h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        sortKey === 'avgDamage'
                          ? 'bg-gradient-to-r from-[var(--primary)] to-blue-400'
                          : 'bg-gradient-to-r from-green-500 to-green-400'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-[var(--card-border)] gap-2">
        <span className="text-xs text-[var(--text-secondary)]">
          {safePage + 1}/{totalPages}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handlePrev}
            disabled={safePage === 0}
            className="px-2 py-1 text-xs bg-[var(--card-bg)] hover:bg-[var(--bg-tertiary)] disabled:bg-[var(--card-bg)] disabled:text-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)] rounded transition-colors"
          >
            &lt;
          </button>
          <button
            onClick={handleNext}
            disabled={safePage >= totalPages - 1}
            className="px-2 py-1 text-xs bg-[var(--card-bg)] hover:bg-[var(--bg-tertiary)] disabled:bg-[var(--card-bg)] disabled:text-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)] rounded transition-colors"
          >
            &gt;
          </button>
        </div>
      </CardFooter>
    </Card>
  )
}

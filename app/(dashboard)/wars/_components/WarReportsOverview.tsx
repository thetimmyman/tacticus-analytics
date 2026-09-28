'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@tacticus/ui-kit'
import { Badge } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import {
  Sword,
  Trophy,
  Target,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Clock
} from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import {
  buildEstimatedPhaseFromMatch,
  buildPhaseFromMatch,
  type WarPhaseInfo
} from '@/app/lib/war/timing/phase-calculator'
import { type WarMatch } from './war-reports-model'
import { useWarReportsData } from './useWarReportsData'

interface WarReportsOverviewProps {
  guildCode: string
}

function WarCountdownTimer({
  activeMatch,
  phaseMatch,
  recentMatch
}: {
  activeMatch?: WarMatch
  phaseMatch?: WarMatch | null
  recentMatch?: WarMatch
}) {
  const [phaseInfo, setPhaseInfo] = useState<WarPhaseInfo | null>(null)
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  })

  useEffect(() => {
    const updateCountdown = () => {
      const nowMs = Date.now()
      // phaseMatch = unknown-opponent war during prep.
      const phaseSource = activeMatch ?? phaseMatch ?? undefined
      const matchPhase = phaseSource
        ? buildPhaseFromMatch(phaseSource, nowMs)
        : null
      let info =
        matchPhase ??
        (recentMatch ? buildEstimatedPhaseFromMatch(recentMatch, nowMs) : null)

      if (!info) {
        setPhaseInfo(null)
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 })
        return
      }

      if (
        !activeMatch &&
        !phaseMatch &&
        info.isEstimated &&
        info.phase === 'active'
      ) {
        info = {
          ...info,
          phase: 'between_seasons',
          nextEventLabel: 'Next Season TBD',
          sourceLabel: 'No active war data'
        }
      }

      setPhaseInfo(info)

      const diff = info.nextEventTime.getTime() - nowMs
      if (diff > 0) {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24))
        const hours = Math.floor(
          (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
        )
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((diff % (1000 * 60)) / 1000)
        setTimeLeft({ days, hours, minutes, seconds })
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 })
      }
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [activeMatch, phaseMatch, recentMatch])

  if (!phaseInfo) {
    return (
      <Card className="border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)]">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-secondary-wh40k" />
            <div>
              <span className="text-sm font-medium text-secondary-wh40k">
                War timer unavailable
              </span>
              <span className="text-xs text-(--text-tertiary) block">
                Waiting for war schedule data.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isWarActive = phaseInfo.phase === 'active'
  const isBetweenSeasons = phaseInfo.phase === 'between_seasons'
  const hasNoActiveWarData = phaseInfo.sourceLabel === 'No active war data'
  const warLabel =
    phaseInfo.warNumber > 0 ? `War ${phaseInfo.warNumber}` : 'Current War'
  const seasonLabel =
    phaseInfo.seasonNumber > 0
      ? `Season ${phaseInfo.seasonNumber}`
      : 'Season TBD'
  const phaseLabel = (() => {
    switch (phaseInfo.phase) {
      case 'prep':
        return `${warLabel} Prep Phase`
      case 'active':
        return `${warLabel} Active Phase`
      case 'between_wars':
        return 'Between Wars'
      case 'between_seasons':
        return 'Between Seasons'
      default:
        return 'War Phase'
    }
  })()

  if (isBetweenSeasons && hasNoActiveWarData) {
    return (
      <Card className="border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)]">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-secondary-wh40k" />
            <div>
              <span className="text-sm font-medium text-secondary-wh40k">
                Between Seasons
              </span>
              <span className="text-xs text-(--text-tertiary) block">
                No active war. Next season schedule TBD.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className={
        isWarActive
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-[color-mix(in_srgb,var(--accent)_30%,transparent)]'
      }
    >
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            {isWarActive ? (
              <Sword className="h-5 w-5 text-green-400 animate-pulse" />
            ) : (
              <Clock className="h-5 w-5 text-(--accent)" />
            )}
            <div>
              <span
                className={`text-sm font-medium ${isWarActive ? 'text-green-400' : 'text-secondary-wh40k'}`}
              >
                {isWarActive
                  ? `${warLabel} In Progress!`
                  : phaseInfo.nextEventLabel}
              </span>
              <span className="text-xs text-(--text-tertiary) block">
                {seasonLabel} - {phaseLabel}
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-(--text-tertiary)">
                <span>Source: {phaseInfo.sourceLabel}</span>
                {phaseInfo.isEstimated && (
                  <Badge className="border-(--border) bg-(--bg-secondary) text-secondary-wh40k text-[10px] uppercase tracking-wide">
                    Estimated
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {phaseInfo.isEstimated ? (
            <div className="text-right text-xs text-secondary-wh40k max-w-[160px]">
              Schedule is estimated from past wars. Sync to get live war status.
            </div>
          ) : (
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="text-center">
                <span className="text-xl sm:text-2xl font-bold text-primary-wh40k font-mono">
                  {timeLeft.days}
                </span>
                <span className="text-[10px] sm:text-xs text-secondary-wh40k block">
                  Days
                </span>
              </div>
              <span className="text-xl sm:text-2xl font-bold text-(--text-tertiary)">
                :
              </span>
              <div className="text-center">
                <span className="text-xl sm:text-2xl font-bold text-primary-wh40k font-mono">
                  {String(timeLeft.hours).padStart(2, '0')}
                </span>
                <span className="text-[10px] sm:text-xs text-secondary-wh40k block">
                  Hours
                </span>
              </div>
              <span className="text-xl sm:text-2xl font-bold text-(--text-tertiary)">
                :
              </span>
              <div className="text-center">
                <span className="text-xl sm:text-2xl font-bold text-primary-wh40k font-mono">
                  {String(timeLeft.minutes).padStart(2, '0')}
                </span>
                <span className="text-[10px] sm:text-xs text-secondary-wh40k block">
                  Mins
                </span>
              </div>
              <span className="text-xl sm:text-2xl font-bold text-(--text-tertiary)">
                :
              </span>
              <div className="text-center">
                <span className="text-xl sm:text-2xl font-bold text-(--accent) font-mono">
                  {String(timeLeft.seconds).padStart(2, '0')}
                </span>
                <span className="text-[10px] sm:text-xs text-secondary-wh40k block">
                  Secs
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function WarReportsOverview({
  guildCode
}: WarReportsOverviewProps) {
  const {
    data: queryResult,
    isLoading,
    error,
    refetch
  } = useWarReportsData(guildCode)

  const activeMatches = queryResult?.activeMatches ?? []
  const warStats = queryResult?.warStats ?? null
  // phaseMatch keeps the card when the opponent-name filter excludes the row in early prep.
  const displayMatches: WarMatch[] =
    activeMatches.length > 0
      ? activeMatches
      : queryResult?.phaseMatch
        ? [queryResult.phaseMatch]
        : []
  const mostRecentMatch = queryResult?.allMatches?.[0] ?? displayMatches[0]
  const avgScoreDiff = warStats?.avg_score_differential ?? 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-secondary-wh40k">Loading war data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card-wh40k p-6">
        <div className="text-center">
          <p className="text-red-400 mb-4">
            {error instanceof Error ? error.message : 'Failed to load war data'}
          </p>
          <Button onClick={() => refetch()} variant="outline">
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6 px-3 md:px-0">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        <Card>
          <CardContent className="p-3 md:p-6">
            <div className="flex items-center space-x-2">
              <Trophy className="h-4 w-4 md:h-5 md:w-5 text-(--accent) shrink-0" />
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-secondary-wh40k truncate">
                  Win Rate
                </p>
                <p className="text-lg md:text-2xl font-bold text-primary-wh40k">
                  {Math.round(warStats?.win_rate ?? 0)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-6">
            <div className="flex items-center space-x-2">
              <Sword className="h-4 w-4 md:h-5 md:w-5 text-(--accent) shrink-0" />
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-secondary-wh40k truncate">
                  Total Wars
                </p>
                <p className="text-lg md:text-2xl font-bold text-primary-wh40k">
                  {warStats?.total_wars || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-6">
            <div className="flex items-center space-x-2">
              <Target className="h-4 w-4 md:h-5 md:w-5 text-(--accent) shrink-0" />
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-secondary-wh40k truncate">
                  Active Wars
                </p>
                <p className="text-lg md:text-2xl font-bold text-primary-wh40k">
                  {displayMatches.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-6">
            <div className="flex items-center space-x-2">
              {warStats?.streak_type === 'win' ? (
                <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-green-400 shrink-0" />
              ) : warStats?.streak_type === 'loss' ? (
                <TrendingDown className="h-4 w-4 md:h-5 md:w-5 text-red-400 shrink-0" />
              ) : (
                <BarChart3 className="h-4 w-4 md:h-5 md:w-5 text-(--accent) shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-secondary-wh40k truncate">
                  Streak
                </p>
                <p className="text-lg md:text-2xl font-bold text-primary-wh40k">
                  {warStats?.current_streak || 0}
                  {warStats?.streak_type && (
                    <span
                      className={`ml-1 text-xs md:text-sm ${
                        warStats.streak_type === 'win'
                          ? 'text-green-400'
                          : 'text-red-400'
                      }`}
                    >
                      {warStats.streak_type === 'win' ? 'W' : 'L'}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-6">
            <div className="flex items-center space-x-2">
              <BarChart3 className="h-4 w-4 md:h-5 md:w-5 text-(--accent) shrink-0" />
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-secondary-wh40k truncate">
                  Avg Diff
                </p>
                <p
                  className={`text-lg md:text-2xl font-bold ${
                    avgScoreDiff > 0
                      ? 'text-green-400'
                      : avgScoreDiff < 0
                        ? 'text-red-400'
                        : 'text-primary-wh40k'
                  }`}
                >
                  {avgScoreDiff > 0 ? '+' : ''}
                  {formatNumber(avgScoreDiff)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-6">
            <div className="flex items-center space-x-2">
              <Trophy className="h-4 w-4 md:h-5 md:w-5 text-(--accent) shrink-0" />
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-secondary-wh40k truncate">
                  Form
                </p>
                <p className="text-sm md:text-lg font-bold text-primary-wh40k font-mono">
                  {warStats?.recent_form || 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <WarCountdownTimer
        activeMatch={activeMatches[0]}
        phaseMatch={queryResult?.phaseMatch}
        recentMatch={mostRecentMatch}
      />
    </div>
  )
}

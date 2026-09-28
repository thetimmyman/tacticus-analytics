'use client'

import { formatNumber } from '@tacticus/app-core/formatters'
import { formatShortDuration } from '@/app/components/token-usage/utils'

interface BurnPlayerStat {
  displayName: string
  burnedTokens: number
  overcappedTokens: number
  timeOverCapSeconds: number
}

interface BurnSummary {
  hasData: boolean
  totalBurnedTokens: number
  totalOvercappedTokens: number
  playersWithBurnedTokens: number
  totalTimeOverCapSeconds: number
  topBurnedPlayers: BurnPlayerStat[]
}

interface PerformanceBurnStatsProps {
  season: string
  burnSummary: BurnSummary
  isLoading?: boolean
}

function formatOverCap(seconds: number): string {
  return formatShortDuration(seconds) ?? '0m'
}

export function PerformanceBurnStats({
  season,
  burnSummary,
  isLoading = false
}: PerformanceBurnStatsProps) {
  return (
    <div className="card-wh40k p-4">
      <h3 className="heading-wh40k">Token Waste Snapshot</h3>
      <p className="mt-1 text-xs text-secondary-wh40k">
        Season {season}. Burn metrics reflect players shown in this view.
      </p>
      <p className="mt-1 text-xs text-secondary-wh40k">
        Behind pace = tokens behind the guild&apos;s most active member
        (participation proxy). Overcapped = tokens physically wasted at the 3/3
        cap (unrecoverable).
      </p>

      {isLoading && (
        <p className="mt-4 text-sm text-secondary-wh40k">
          Loading burn statistics...
        </p>
      )}

      {!isLoading && !burnSummary.hasData && (
        <p className="mt-4 text-sm text-secondary-wh40k">
          Burn statistics are not available for this guild and season yet.
        </p>
      )}

      {!isLoading && burnSummary.hasData && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-sm border border-(--card-border) bg-(--card-bg) p-3">
              <div className="text-xs uppercase tracking-wide text-(--text-tertiary)">
                Behind pace
              </div>
              <div className="text-lg font-semibold text-primary-wh40k">
                {formatNumber(burnSummary.totalBurnedTokens)}
              </div>
            </div>
            <div className="rounded-sm border border-(--card-border) bg-(--card-bg) p-3">
              <div className="text-xs uppercase tracking-wide text-(--text-tertiary)">
                Overcapped
              </div>
              <div className="text-lg font-semibold text-primary-wh40k">
                {formatNumber(burnSummary.totalOvercappedTokens)}
              </div>
            </div>
            <div className="rounded-sm border border-(--card-border) bg-(--card-bg) p-3">
              <div className="text-xs uppercase tracking-wide text-(--text-tertiary)">
                Players Behind Pace 1+
              </div>
              <div className="text-lg font-semibold text-primary-wh40k">
                {formatNumber(burnSummary.playersWithBurnedTokens)}
              </div>
            </div>
            <div className="rounded-sm border border-(--card-border) bg-(--card-bg) p-3">
              <div className="text-xs uppercase tracking-wide text-(--text-tertiary)">
                Total Time Over Cap
              </div>
              <div className="text-lg font-semibold text-primary-wh40k">
                {formatOverCap(burnSummary.totalTimeOverCapSeconds)}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <h4 className="text-sm font-medium text-primary-wh40k">
              Most Impacted Players
            </h4>
            {burnSummary.topBurnedPlayers.length === 0 ? (
              <p className="mt-2 text-xs text-secondary-wh40k">
                No burned tokens recorded for visible players.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="table-wh40k">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th className="text-right">Behind pace</th>
                      <th className="text-right">Overcapped</th>
                      <th className="text-right">Time Over Cap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {burnSummary.topBurnedPlayers.map((player) => (
                      <tr key={player.displayName}>
                        <td className="font-medium">{player.displayName}</td>
                        <td className="text-right">
                          {formatNumber(player.burnedTokens)}
                        </td>
                        <td className="text-right">
                          {formatNumber(player.overcappedTokens)}
                        </td>
                        <td className="text-right">
                          {formatOverCap(player.timeOverCapSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

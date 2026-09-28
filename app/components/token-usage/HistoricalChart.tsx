'use client'

import { memo, useMemo } from 'react'
import { formatNumber, formatPercentage } from '@tacticus/app-core/formatters'
import type { PlayerTokens } from './types'

interface HistoricalChartProps {
  players: PlayerTokens[]
}

function HistoricalChart({ players }: HistoricalChartProps) {
  const playersWithHistorical = useMemo(
    () => players.filter((p) => p.historicalAvg !== undefined),
    [players]
  )

  if (playersWithHistorical.length === 0) {
    return null
  }

  const sortedPlayers = [...playersWithHistorical].sort(
    (a, b) => (b.historicalAvg || 0) - (a.historicalAvg || 0)
  )

  const maxHistorical = Math.max(
    ...playersWithHistorical.map((p) => p.historicalAvg || 0),
    1
  )

  return (
    <div className="card-wh40k p-3 sm:p-4">
      <h3 className="heading-wh40k text-base sm:text-lg mb-2">
        Historical Token Usage (5-Season Average)
      </h3>
      <p className="text-[10px] sm:text-xs text-secondary-wh40k mb-3">
        Only showing players who participated in all of the past 5 completed
        seasons
      </p>

      <div className="relative -mx-3 sm:mx-0">
        <div className="flex gap-1 sm:gap-2 overflow-x-auto px-3 sm:px-0 pb-3 sm:pb-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
          {sortedPlayers.map((player) => {
            const barHeight =
              ((player.historicalAvg || 0) / maxHistorical) * 100
            const currentVsHistorical = player.historicalAvg
              ? (player.totalTokens / player.historicalAvg - 1) * 100
              : 0

            return (
              <div
                key={player.userId}
                className="shrink-0 text-center"
                style={{ width: '50px' }}
              >
                <div className="h-32 sm:h-48 flex flex-col justify-end mb-1">
                  <div
                    className="w-full bg-linear-to-t from-green-500 to-green-400 rounded-t-sm transition-all duration-1000 ease-out flex flex-col justify-end items-center"
                    style={{ height: `${barHeight}%` }}
                  >
                    <span
                      className={`text-primary-wh40k font-bold ${barHeight < 15 ? 'text-[8px]' : 'text-[10px] sm:text-xs'}`}
                    >
                      {player.historicalAvg
                        ? formatNumber(player.historicalAvg, 1)
                        : ''}
                    </span>
                  </div>
                </div>
                <div className="text-[10px] sm:text-xs">
                  <div
                    className="font-medium text-secondary-wh40k truncate"
                    title={player.displayName}
                  >
                    {player.displayName.length > 6
                      ? player.displayName.substring(0, 6) + '..'
                      : player.displayName}
                  </div>
                  <div className="text-secondary-wh40k text-[9px] sm:text-[10px]">
                    Now: {player.totalTokens}
                    {currentVsHistorical !== 0 && (
                      <span className="ml-0.5">
                        (
                        {formatPercentage(
                          Math.abs(currentVsHistorical) / 100,
                          0
                        )}
                        )
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default memo(HistoricalChart)

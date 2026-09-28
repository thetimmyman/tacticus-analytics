'use client'

import { memo, useMemo } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { PlayerTokens } from './types'

interface BurnedTokensChartProps {
  players: PlayerTokens[]
}

function BurnedTokensChart({ players }: BurnedTokensChartProps) {
  const burnedRanking = useMemo(() => {
    return [...players]
      .filter(
        (p) =>
          p.burnedTokensUsage !== null &&
          p.burnedTokensUsage !== undefined &&
          p.burnedTokensUsage > 0
      )
      .sort((a, b) => (b.burnedTokensUsage ?? 0) - (a.burnedTokensUsage ?? 0))
  }, [players])

  const maxBurned =
    burnedRanking.length > 0
      ? Math.max(...burnedRanking.map((p) => p.burnedTokensUsage ?? 0), 0)
      : 0

  if (burnedRanking.length === 0) {
    return null
  }

  return (
    <div className="card-wh40k p-3 sm:p-4">
      <h3 className="heading-wh40k text-base sm:text-lg mb-3">
        Behind Pace by Player
      </h3>
      <div className="relative -mx-3 sm:mx-0">
        <div className="flex gap-1 sm:gap-2 overflow-x-auto px-3 sm:px-0 pb-3 sm:pb-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
          {burnedRanking.map((player, index) => {
            const burned = player.burnedTokensUsage ?? 0
            const barHeightPercent =
              maxBurned > 0 ? (burned / maxBurned) * 100 : 0

            return (
              <div
                key={player.userId}
                className="shrink-0 text-center"
                style={{ width: '50px' }}
              >
                <div className="h-28 sm:h-36 flex flex-col justify-end mb-1">
                  <div
                    className="w-full rounded-t-sm overflow-hidden relative bg-(--card-bg) border border-(--card-border)"
                    style={{
                      height: `${barHeightPercent}%`,
                      minHeight: burned > 0 ? '12px' : '0'
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center text-primary-wh40k font-bold text-[10px] sm:text-xs">
                      {formatNumber(burned)}
                    </div>
                    <div
                      className="absolute inset-x-0 bottom-0 h-full bg-[color-mix(in_srgb,var(--accent)_70%,transparent)]"
                      style={{ height: '100%' }}
                    />
                  </div>
                </div>
                <div className="text-[10px] sm:text-xs">
                  <div
                    className="font-medium text-secondary-wh40k truncate"
                    title={player.displayName}
                  >
                    <PlayerLink playerName={player.displayName}>
                      {player.displayName.length > 6
                        ? player.displayName.substring(0, 6) + '..'
                        : player.displayName}
                    </PlayerLink>
                  </div>
                  <div className="text-(--text-tertiary) text-[10px]">
                    #{index + 1}
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

export default memo(BurnedTokensChart)

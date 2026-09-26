'use client'

import { memo } from 'react'
import { formatNumber, formatPercentage } from '@tacticus/app-core/formatters'
import { getRarityColors } from '@tacticus/charting/theme'
import type { PlayerTokens } from './types'

const RARITY_COLORS = getRarityColors()

interface RarityDistributionChartProps {
  players: PlayerTokens[]
}

function RarityDistributionChart({ players }: RarityDistributionChartProps) {
  const totalByRarity = players.reduce(
    (acc, player) => {
      Object.entries(player.tokensByRarity).forEach(([rarity, count]) => {
        acc[rarity] = (acc[rarity] || 0) + count
      })
      return acc
    },
    {} as Record<string, number>
  )

  const grandTotal = Object.values(totalByRarity).reduce(
    (sum, count) => sum + count,
    0
  )

  return (
    <div className="card-wh40k p-3 sm:p-4">
      <h3 className="heading-wh40k text-base sm:text-lg mb-3">
        Token Distribution by Rarity
      </h3>

      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        {Object.entries(RARITY_COLORS).map(([rarity, color]) => (
          <div key={rarity} className="flex items-center gap-1">
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: color }}
            />
            <span className="capitalize text-[var(--text-secondary)]">
              {rarity}
            </span>
          </div>
        ))}
      </div>

      <div className="flex h-8 rounded-lg overflow-hidden mb-4">
        {Object.entries(RARITY_COLORS).map(([rarity, color]) => {
          const count = totalByRarity[rarity] || 0
          const percentage = grandTotal > 0 ? (count / grandTotal) * 100 : 0
          if (percentage === 0) return null

          return (
            <div
              key={rarity}
              className="h-full flex items-center justify-center text-xs font-medium"
              style={{
                backgroundColor: color,
                width: `${percentage}%`,
                color: rarity === 'common' ? '#1e293b' : 'white'
              }}
              title={`${rarity}: ${count} tokens (${formatPercentage(percentage / 100)})`}
            >
              {percentage > 5 && formatPercentage(percentage / 100, 0)}
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        {Object.entries(RARITY_COLORS)
          .filter(([rarity]) => (totalByRarity[rarity] || 0) > 0)
          .map(([rarity, color]) => {
            const count = totalByRarity[rarity] || 0
            const percentage = grandTotal > 0 ? (count / grandTotal) * 100 : 0

            return (
              <div key={rarity} className="text-center">
                <div className="text-[var(--text-secondary)] capitalize">
                  {rarity}
                </div>
                <div className="font-bold" style={{ color }}>
                  {formatNumber(count)}
                </div>
                <div className="text-[var(--text-secondary)]">
                  {formatPercentage(percentage / 100)}
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}

export default memo(RarityDistributionChart)

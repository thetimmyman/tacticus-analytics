'use client'

import { memo } from 'react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { PlayerTokens, TotalStats } from './types'

interface TokenUsageStatsProps {
  players: PlayerTokens[]
  totalStats: TotalStats
}

function TokenUsageStats({ players, totalStats }: TokenUsageStatsProps) {
  return (
    <div className="card-wh40k p-3 sm:p-4">
      <h3 className="heading-wh40k text-base sm:text-lg mb-3">
        Token Usage Statistics
      </h3>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm mb-3">
        <div>
          <div className="font-medium text-primary-wh40k text-xs">
            Active Players
          </div>
          <div className="text-lg sm:text-2xl font-bold text-accent-wh40k">
            {players.length}
          </div>
        </div>
        <div>
          <div className="font-medium text-primary-wh40k text-xs">
            Avg Tokens/Player
          </div>
          <div className="text-lg sm:text-2xl font-bold text-accent-wh40k">
            {formatNumber(totalStats.totalTokens / players.length, 1)}
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-primary-wh40k">
        <div className="text-xs sm:text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-primary-wh40k">28+ tokens:</span>
            <span className="font-mono text-accent-wh40k">
              {players.filter((p) => p.totalTokens >= 28).length}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-primary-wh40k">20-27 tokens:</span>
            <span className="font-mono text-accent-wh40k">
              {
                players.filter((p) => p.totalTokens >= 20 && p.totalTokens < 28)
                  .length
              }
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-primary-wh40k">&lt;20 tokens:</span>
            <span className="font-mono text-accent-wh40k">
              {players.filter((p) => p.totalTokens < 20).length}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(TokenUsageStats)

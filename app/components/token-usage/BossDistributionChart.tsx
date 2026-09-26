'use client'

import { memo } from 'react'
import { BossLink } from '@/app/components/ui/BossLink'
import { formatPercentage } from '@tacticus/app-core/formatters'
import type { BossTokenData } from './types'

interface BossDistributionChartProps {
  bossDistribution: BossTokenData[]
}

function BossDistributionChart({
  bossDistribution
}: BossDistributionChartProps) {
  return (
    <div className="card-wh40k p-3 sm:p-4">
      <h3 className="heading-wh40k text-base sm:text-lg mb-3">
        Boss Token Distribution
      </h3>

      <div className="mb-3">
        <div className="flex h-3 sm:h-4 rounded-full overflow-hidden">
          {bossDistribution.map((boss) => (
            <div
              key={boss.bossName}
              style={{
                width: `${boss.percentage}%`,
                backgroundColor: boss.color
              }}
              className="h-full"
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 sm:gap-2 text-xs sm:text-sm">
        {bossDistribution.slice(0, 6).map((boss) => (
          <div
            key={boss.bossName}
            className="flex items-center space-x-1 sm:space-x-2"
          >
            <div
              className="w-2 h-2 sm:w-3 sm:h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: boss.color }}
            />
            <span className="truncate text-xs text-primary-wh40k">
              <BossLink bossName={boss.bossName}>
                {boss.bossName.replace(/^L\d\s/, '')}
              </BossLink>
              : {formatPercentage(boss.percentage / 100, 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(BossDistributionChart)

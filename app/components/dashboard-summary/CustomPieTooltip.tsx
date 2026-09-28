'use client'

import { formatNumber } from '@tacticus/app-core/formatters'
import type { TooltipProps } from '@/app/components/dashboard-summary/types'

export function CustomPieTooltip({ active, payload, label }: TooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip">
        <p className="text-primary-wh40k font-bold mb-1">{label}</p>
        {payload.map((entry) => (
          <p key={entry.name} className="data-value m-0">
            {`${formatNumber(entry.value)} tokens`}
          </p>
        ))}
      </div>
    )
  }
  return null
}

'use client'

import type { GuildTrendsRow } from '@/app/lib/hooks/queries'
import { formatNumber, formatPercentage } from '@tacticus/app-core/formatters'
import { TrendChartCard } from './TrendChartCard'

interface GuildTokenTrendChartProps {
  data: GuildTrendsRow[]
}

export function GuildTokenTrendChart({ data }: GuildTokenTrendChartProps) {
  return (
    <TrendChartCard
      title="Token Utilization"
      data={data}
      trendAccessor={(d) => d.total_battles}
      badge={{ variant: 'cagr' }}
      leftAxis={{ domain: [672, 840] }}
      rightAxis={{ tickFormatter: (v) => `${v}%`, domain: [80, 100] }}
      bar={{
        yAxisId: 'left',
        dataKey: 'total_battles',
        fill: '#F59E0B',
        name: 'Tokens Spent',
        opacity: 0.8
      }}
      lines={[
        {
          yAxisId: 'right',
          dataKey: 'participation_rate',
          stroke: '#9333EA',
          strokeWidth: 2,
          name: 'Participation Rate',
          dot: { r: 3 }
        }
      ]}
      tooltipFormatter={(value, name) => [
        value == null
          ? '—'
          : name === 'Participation Rate'
            ? formatPercentage(value / 100)
            : formatNumber(value),
        name
      ]}
    />
  )
}

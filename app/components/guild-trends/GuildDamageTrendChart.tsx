'use client'

import type { GuildTrendsRow } from '@/app/lib/hooks/queries'
import { formatDamage } from '@tacticus/app-core/formatters'
import { TrendChartCard } from './TrendChartCard'

interface GuildDamageTrendChartProps {
  data: GuildTrendsRow[]
}

export function GuildDamageTrendChart({ data }: GuildDamageTrendChartProps) {
  return (
    <TrendChartCard
      title="Damage Trend"
      data={data}
      trendAccessor={(d) => d.total_damage}
      badge={{ variant: 'cagr' }}
      leftAxis={{ tickFormatter: (v) => formatDamage(v) }}
      rightAxis={{}}
      bar={{
        yAxisId: 'left',
        dataKey: 'total_damage',
        fill: '#3B82F6',
        name: 'Total Damage',
        opacity: 0.8
      }}
      lines={[
        {
          yAxisId: 'right',
          dataKey: 'active_players',
          stroke: '#10B981',
          strokeWidth: 2,
          name: 'Active Players',
          dot: { r: 3 }
        }
      ]}
      tooltipFormatter={(value, name) => [
        value == null
          ? '—'
          : name === 'Active Players'
            ? String(value)
            : formatDamage(value),
        name
      ]}
    />
  )
}

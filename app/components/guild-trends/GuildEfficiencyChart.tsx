'use client'

import type { GuildTrendsRow } from '@/app/lib/hooks/queries'
import { formatDamage } from '@tacticus/app-core/formatters'
import { TrendChartCard } from './TrendChartCard'

interface GuildEfficiencyChartProps {
  data: GuildTrendsRow[]
}

const mapRow = (row: GuildTrendsRow, trendValue: number | undefined) => ({
  season: row.season,
  avgDamagePerToken: row.avg_damage_per_token ?? 0,
  trendline: trendValue
})

export function GuildEfficiencyChart({ data }: GuildEfficiencyChartProps) {
  return (
    <TrendChartCard
      title="Efficiency (Avg Damage / Token)"
      data={data}
      trendAccessor={(d) => d.avg_damage_per_token}
      badge={{ variant: 'cagr' }}
      mapRow={mapRow}
      leftAxis={{ tickFormatter: (v) => formatDamage(v) }}
      bar={{
        dataKey: 'avgDamagePerToken',
        fill: '#facc15',
        name: 'Avg Damage/Token',
        opacity: 0.8
      }}
      trendLine={{
        dataKey: 'trendline',
        stroke: '#ef4444',
        strokeWidth: 2,
        name: 'Trend',
        dot: false,
        connectNulls: true,
        onlyWhenTrend: true
      }}
      tooltipFormatter={(value, name) => [
        value == null ? '—' : formatDamage(value),
        name === 'trendline' ? 'Trend' : name
      ]}
    />
  )
}

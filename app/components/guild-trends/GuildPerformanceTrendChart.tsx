'use client'

import type { GuildTrendsRow } from '@/app/lib/hooks/queries'
import { formatPercentageDiff } from '@tacticus/app-core/formatters'
import { TrendChartCard } from './TrendChartCard'

interface GuildPerformanceTrendChartProps {
  data: GuildTrendsRow[]
}

const mapRow = (row: GuildTrendsRow, trendValue: number | undefined) => ({
  season: row.season,
  vs_cluster_percent: row.vs_cluster_percent,
  total_battles: row.total_battles,
  vsClusterTrend: trendValue
})

export function GuildPerformanceTrendChart({
  data
}: GuildPerformanceTrendChartProps) {
  return (
    <TrendChartCard
      title="vs Cluster Trend"
      data={data}
      trendAccessor={(d) => d.vs_cluster_percent}
      badge={{
        variant: 'slope',
        unit: '%',
        hoverTitle:
          'Change per season of the vs-Cluster regression trendline, in percentage points.'
      }}
      mapRow={mapRow}
      leftAxis={{
        tickFormatter: (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`
      }}
      rightAxis={{}}
      zeroReferenceLine
      bar={{
        yAxisId: 'right',
        dataKey: 'total_battles',
        fill: '#F97316',
        name: 'Tokens Used',
        opacity: 0.6
      }}
      lines={[
        {
          yAxisId: 'left',
          dataKey: 'vs_cluster_percent',
          stroke: '#3B82F6',
          strokeWidth: 2,
          name: 'vs Cluster %',
          dot: { r: 3 }
        }
      ]}
      trendLine={{
        yAxisId: 'left',
        dataKey: 'vsClusterTrend',
        stroke: '#3B82F6',
        strokeWidth: 1,
        dashed: true,
        dot: false,
        hideLegend: true,
        connectNulls: true
      }}
      tooltipFormatter={(value, name) => [
        value == null
          ? '—'
          : name === 'Tokens Used'
            ? String(value)
            : formatPercentageDiff(value, 1),
        name
      ]}
    />
  )
}

'use client'

import type { GuildTrendsRow } from '@/app/lib/hooks/queries'
import { TrendChartCard } from './TrendChartCard'

interface GuildReliabilityTrendChartProps {
  data: GuildTrendsRow[]
}

const mapRow = (row: GuildTrendsRow, trendValue: number | undefined) => ({
  season: row.season,
  reliability_score: row.reliability_score,
  reliabilityTrend: trendValue
})

export function GuildReliabilityTrendChart({
  data
}: GuildReliabilityTrendChartProps) {
  return (
    <TrendChartCard
      title="Reliability Trend"
      data={data}
      trendAccessor={(d) => d.reliability_score}
      badge={{
        variant: 'slope',
        hoverTitle:
          'Change per season of the reliability regression trendline, in score points.'
      }}
      chartType="line"
      mapRow={mapRow}
      leftAxis={{ domain: [0, 100], tickFormatter: (v) => `${v}` }}
      lines={[
        {
          dataKey: 'reliability_score',
          stroke: '#A855F7',
          strokeWidth: 2,
          name: 'Reliability',
          dot: { r: 3 }
        }
      ]}
      trendLine={{
        dataKey: 'reliabilityTrend',
        stroke: '#A855F7',
        strokeWidth: 1,
        dashed: true,
        dot: false,
        hideLegend: true,
        connectNulls: true
      }}
      tooltipFormatter={(value) => [
        value == null ? '—' : value.toFixed(1),
        'Reliability'
      ]}
    />
  )
}

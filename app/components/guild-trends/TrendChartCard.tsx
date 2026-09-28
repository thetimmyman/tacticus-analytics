'use client'

import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { useMemo } from 'react'
import type { GuildTrendsRow } from '@/app/lib/hooks/queries'
import { getTooltipStyles } from '@tacticus/charting/tooltip'
import {
  generateTrendlineData,
  formatCAGR,
  formatTrendPerSeason,
  interpolateTrendValue,
  seasonNumberX
} from '@/app/lib/utils/trend-analysis'
import {
  ComposedChart,
  LineChart,
  Bar,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer
} from '@/app/components/RechartsWrapper'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'

const tooltipStyles = getTooltipStyles().contentStyle

type ChartRow = Record<string, string | number | null | undefined>

export interface TrendBadgeSpec {
  variant: 'cagr' | 'slope'
  unit?: string
  hoverTitle?: string
}

export interface AxisSpec {
  tickFormatter?: (v: number) => string
  domain?: [number, number]
}

export interface BarSpec {
  dataKey: string
  fill: string
  name: string
  opacity: number
  yAxisId?: 'left' | 'right'
}

export interface LineSpec {
  dataKey: string
  stroke: string
  strokeWidth: number
  name?: string
  yAxisId?: 'left' | 'right'
  dot?: { r: number } | false
  dashed?: boolean
  /** Hidden trendlines. */
  hideLegend?: boolean
  connectNulls?: boolean
}

export interface TrendChartCardProps {
  title: string
  data: GuildTrendsRow[]
  trendAccessor: (d: GuildTrendsRow) => number | null | undefined
  badge: TrendBadgeSpec
  /** Default 'composed'; Reliability passes 'line'. */
  chartType?: 'composed' | 'line'
  /** Maps rows with the interpolated trend value per index; absent = plot `data` as-is. */
  mapRow?: (
    row: GuildTrendsRow,
    trendValue: number | undefined,
    index: number,
    total: number
  ) => ChartRow
  leftAxis?: AxisSpec
  /** Present = dual-axis (series carry yAxisId); absent = single axis. */
  rightAxis?: AxisSpec
  /** Performance only: dashed zero line on the left axis. */
  zeroReferenceLine?: boolean
  bar?: BarSpec
  lines?: LineSpec[]
  trendLine?: LineSpec & { onlyWhenTrend?: boolean }
  tooltipFormatter: (
    value: number | undefined,
    name?: string
  ) => [string, string | undefined]
}

function renderLine(spec: LineSpec) {
  return (
    <Line
      key={spec.dataKey}
      {...(spec.yAxisId !== undefined ? { yAxisId: spec.yAxisId } : {})}
      type="monotone"
      dataKey={spec.dataKey}
      stroke={spec.stroke}
      strokeWidth={spec.strokeWidth}
      {...(spec.name !== undefined ? { name: spec.name } : {})}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(spec.dashed ? ({ strokeDasharray: '6 3' } as any) : {})}
      {...(spec.dot !== undefined ? { dot: spec.dot } : {})}
      {...(spec.hideLegend ? { legendType: 'none' as const } : {})}
      {...(spec.connectNulls ? { connectNulls: true } : {})}
    />
  )
}

export function TrendChartCard({
  title,
  data,
  trendAccessor,
  badge,
  chartType = 'composed',
  mapRow,
  leftAxis,
  rightAxis,
  zeroReferenceLine,
  bar,
  lines,
  trendLine,
  tooltipFormatter
}: TrendChartCardProps) {
  const trend = generateTrendlineData(data, trendAccessor, seasonNumberX)

  const chartData = useMemo(() => {
    if (!mapRow) return data
    const n = data.length
    return data.map((row, i) =>
      mapRow(row, interpolateTrendValue(trend, i, n), i, n)
    )
  }, [data, trend, mapRow])

  const badgeValue =
    badge.variant === 'cagr'
      ? formatCAGR(trend?.cagr ?? null)
      : formatTrendPerSeason(trend?.slope, badge.unit)
  const badgePositive =
    badge.variant === 'cagr'
      ? trend?.cagr != null && trend.cagr >= 0
      : (trend?.slope ?? 0) >= 0

  const ChartComponent = chartType === 'line' ? LineChart : ComposedChart

  return (
    <Card className="card-wh40k chart-card">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="subheading-wh40k text-green-400 text-base sm:text-lg">
            {title}
          </CardTitle>
          {trend && (
            <div className="text-right text-[10px]" title={badge.hoverTitle}>
              <span className="text-secondary-wh40k">
                {badge.variant === 'cagr' ? 'CAGR: ' : 'Trend: '}
              </span>
              <span
                className={badgePositive ? 'text-green-400' : 'text-red-400'}
              >
                {badgeValue}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <ResponsiveContainer width="100%" height={280}>
          <ChartComponent data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
            <XAxis
              dataKey="season"
              tick={DEFAULT_AXIS_STYLES.tick}
              tickFormatter={(s: string) => `S${s}`}
            />
            <YAxis
              {...(rightAxis ? { yAxisId: 'left' } : {})}
              tick={DEFAULT_AXIS_STYLES.tick}
              {...(leftAxis?.tickFormatter
                ? { tickFormatter: leftAxis.tickFormatter }
                : {})}
              {...(leftAxis?.domain ? { domain: leftAxis.domain } : {})}
            />
            {rightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={DEFAULT_AXIS_STYLES.tick}
                {...(rightAxis.tickFormatter
                  ? { tickFormatter: rightAxis.tickFormatter }
                  : {})}
                {...(rightAxis.domain ? { domain: rightAxis.domain } : {})}
              />
            )}
            <Tooltip
              contentStyle={tooltipStyles}
              formatter={tooltipFormatter}
              labelFormatter={(s: string) => `Season ${s}`}
            />
            <Legend />
            {zeroReferenceLine && (
              <ReferenceLine
                yAxisId="left"
                y={0}
                stroke="#94a3b8"
                strokeDasharray="3 3"
              />
            )}
            {bar && (
              <Bar
                {...(bar.yAxisId !== undefined ? { yAxisId: bar.yAxisId } : {})}
                dataKey={bar.dataKey}
                fill={bar.fill}
                name={bar.name}
                opacity={bar.opacity}
              />
            )}
            {lines?.map(renderLine)}
            {trendLine &&
              (!trendLine.onlyWhenTrend || trend) &&
              renderLine(trendLine)}
          </ChartComponent>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

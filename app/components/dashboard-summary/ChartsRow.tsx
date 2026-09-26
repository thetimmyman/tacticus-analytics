'use client'

import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  LineChart,
  Line,
  Legend
} from '@/app/components/RechartsWrapper'
import {
  formatNumber,
  formatDamage,
  formatPercentage
} from '@tacticus/app-core/formatters'
import {
  getRarityPrefix,
  normalizeRarity
} from '@tacticus/app-core/rarity-utils'
import { ChartErrorBoundary } from '@/app/components/error'
import {
  COLORS,
  tooltipStyles,
  axisStyles,
  gridStyles,
  lineChartMargins
} from '@/app/components/dashboard-summary/chart-config'
import {
  resolveLoopBossLabel,
  toNumber
} from '@/app/components/dashboard-summary/coerce'
import { CustomPieTooltip } from '@/app/components/dashboard-summary/CustomPieTooltip'
import type { BossPerformanceSummary } from '@/app/components/dashboard-summary/types'

interface ChartsRowProps {
  loadPieChart: boolean
  loadLineChart: boolean
  bossPerformance: BossPerformanceSummary[]
  processedDamageByBossLoop: Array<Record<string, unknown> & { loop: number }>
  damageBossSeries: string[]
}

export function ChartsRow({
  loadPieChart,
  loadLineChart,
  bossPerformance,
  processedDamageByBossLoop,
  damageBossSeries
}: ChartsRowProps) {
  return (
    <>
      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Token Distribution Pie Chart */}
        <div className="card-wh40k p-3 sm:p-4 hover:shadow-xl hover:shadow-[color:color-mix(in_srgb,var(--primary)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] transition-all duration-300">
          <h3 className="subheading-wh40k mb-3 sm:mb-4">
            Token Distribution by Boss
          </h3>
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Pie Chart */}
            <div className="flex-1 min-h-[200px] sm:min-h-[280px]">
              <ChartErrorBoundary chartName="Boss Performance Chart">
                {loadPieChart && bossPerformance.length > 0 ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minHeight={200}
                  >
                    <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <Pie
                        data={bossPerformance.map((b, i) => ({
                          name: `${normalizeRarity(b.rarity) ? getRarityPrefix(normalizeRarity(b.rarity)!) : 'L'}${b.tier} ${getBossDisplayName(b.boss)}`,
                          shortName: `${normalizeRarity(b.rarity) ? getRarityPrefix(normalizeRarity(b.rarity)!) : 'L'}${b.tier}`,
                          value: b.hitCount || 0,
                          percentage: 0, // Will be calculated
                          fill: COLORS[i % COLORS.length]
                        }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={80}
                        dataKey="value"
                        label={(entry: unknown) => {
                          const value =
                            typeof entry === 'object' &&
                            entry !== null &&
                            'value' in entry
                              ? toNumber(
                                  (entry as Record<string, unknown>).value,
                                  0
                                )
                              : 0
                          return value > 0 ? formatNumber(value) : ''
                        }}
                      />
                      {/* Colors come from each item's `fill` (Recharts 3 ignores Cell inside Pie). */}
                      <Tooltip content={<CustomPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-pulse bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-full w-48 h-48"></div>
                  </div>
                )}
              </ChartErrorBoundary>
            </div>

            {/* Legend with values */}
            <div className="flex-1 lg:max-w-[200px]">
              <div className="space-y-2">
                {bossPerformance.map((boss, index) => {
                  const totalTokens = bossPerformance.reduce(
                    (sum, b) => sum + (b.hitCount || 0),
                    0
                  )
                  const percentage =
                    totalTokens > 0
                      ? formatPercentage((boss.hitCount || 0) / totalTokens)
                      : '0%'
                  const bossKey = `legend-${boss.rarity}-${boss.tier}-${boss.boss}`
                  return (
                    <div
                      key={bossKey}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor: COLORS[index % COLORS.length]
                          }}
                        />
                        <span className="text-xs sm:text-sm text-secondary-wh40k">
                          {normalizeRarity(boss.rarity)
                            ? getRarityPrefix(normalizeRarity(boss.rarity)!)
                            : 'L'}
                          {boss.tier} {getBossDisplayName(boss.boss)}
                        </span>
                      </div>
                      <span className="text-xs sm:text-sm font-mono text-primary-wh40k">
                        {percentage}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Total tokens */}
              <div className="mt-4 pt-4 border-t border-[var(--card-border)]">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-secondary-wh40k">
                    Total
                  </span>
                  <span className="text-sm font-mono font-bold text-accent-wh40k">
                    {formatNumber(
                      bossPerformance.reduce(
                        (sum, b) => sum + (b.hitCount || 0),
                        0
                      )
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Damage Trend Chart */}
        <div className="card-wh40k chart-card p-3 sm:p-4 hover:shadow-xl hover:shadow-[color:color-mix(in_srgb,var(--primary)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] transition-all duration-300 overflow-hidden">
          <h3 className="subheading-wh40k">Average Damage per Loop</h3>
          <ChartErrorBoundary chartName="Damage Trend Chart">
            {loadLineChart ? (
              <ResponsiveContainer width="100%" height={340}>
                <LineChart
                  data={processedDamageByBossLoop}
                  margin={{ ...lineChartMargins, bottom: 60 }}
                >
                  <CartesianGrid {...gridStyles} />
                  {damageBossSeries.map((boss, index) => (
                    <Line
                      key={boss}
                      type="monotone"
                      dataKey={boss}
                      stroke={COLORS[index % COLORS.length]}
                      name={resolveLoopBossLabel(boss)}
                      strokeWidth={2}
                      connectNulls={false}
                    />
                  ))}
                  <XAxis
                    dataKey="loop"
                    {...axisStyles}
                    tickFormatter={(value: number) => `Loop ${value}`}
                  />
                  <YAxis
                    {...axisStyles}
                    tickFormatter={(value: number) => formatDamage(value)}
                  />
                  <Tooltip
                    contentStyle={tooltipStyles}
                    labelFormatter={(value: string | number) => `Loop ${value}`}
                    formatter={(value: number | undefined) => [
                      value == null ? '—' : formatDamage(value, 2),
                      ''
                    ]}
                  />
                  <Legend
                    verticalAlign="bottom"
                    wrapperStyle={{
                      paddingTop: 8,
                      fontSize: '12px',
                      lineHeight: '1.4'
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[340px]">
                <div className="animate-pulse bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded w-full h-full"></div>
              </div>
            )}
          </ChartErrorBoundary>
        </div>
      </div>
    </>
  )
}

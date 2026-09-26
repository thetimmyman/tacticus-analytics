'use client'

import { DEFAULT_RECHARTS_TOOLTIP_PROPS } from '@tacticus/charting/tooltip'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  LabelList
} from '@/app/components/RechartsWrapper'
import { formatNumber } from '@tacticus/app-core/formatters'
import { ChartErrorBoundary } from '@/app/components/error'
import { COLORS } from '@/app/components/dashboard-summary/chart-config'
import type { LoopTokenSetData } from '@/app/components/dashboard-summary/types'

interface TokensPerLapStackedChartProps {
  loadBarChart: boolean
  loopTokenDataBySet: LoopTokenSetData | null
}

export function TokensPerLapStackedChart({
  loadBarChart,
  loopTokenDataBySet
}: TokensPerLapStackedChartProps) {
  return (
    <>
      {/* Combined Tokens per Lap Stacked Bar Chart */}
      <div className="card-wh40k chart-card p-3 sm:p-4 hover:shadow-xl hover:shadow-[color:color-mix(in_srgb,var(--primary)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] transition-all duration-300">
        <h3 className="subheading-wh40k mb-4">
          Combined Tokens per Lap (Stacked by Set)
        </h3>
        <ChartErrorBoundary chartName="Tokens per Lap Chart">
          {loadBarChart ? (
            <ResponsiveContainer width="100%" height={420}>
              <BarChart
                data={loopTokenDataBySet?.chartData ?? []}
                margin={{ top: 24, right: 20, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis
                  dataKey="lap"
                  stroke="#888"
                  tickFormatter={(value: number) => `Lap ${value}`}
                />
                <YAxis
                  stroke="#888"
                  tickFormatter={(value: number) => formatNumber(value, 0)}
                />
                <Tooltip
                  contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                  labelFormatter={(value: string | number) => `Lap ${value}`}
                  formatter={(value: number | undefined) => [
                    value == null ? '—' : formatNumber(value, 0),
                    ''
                  ]}
                />
                <Legend />

                {/* Dynamic bars for each level - L1 at bottom, M1 at top */}
                {(loopTokenDataBySet?.levelKeys ?? []).map(
                  (levelKey: string, index: number, arr: string[]) => {
                    const levelColors: Record<string, string> = {
                      L1: '#10B981', // Green
                      L2: '#3B82F6', // Blue
                      L3: '#F59E0B', // Amber
                      L4: '#8B5CF6', // Violet
                      L5: '#EF4444', // Red
                      M1: '#9333EA', // Purple
                      M2: '#A855F7',
                      M3: '#C084FC',
                      M4: '#D8B4FE',
                      M5: '#E9D5FF'
                    }
                    const color =
                      levelColors[levelKey] || COLORS[index % COLORS.length]
                    const isTopBar = index === arr.length - 1

                    return (
                      <Bar
                        key={levelKey}
                        dataKey={levelKey}
                        stackId="a"
                        fill={color}
                        name={levelKey}
                      >
                        <LabelList
                          dataKey={levelKey}
                          position="center"
                          fill="#ffffff"
                          fontSize={10}
                          fontWeight="bold"
                          formatter={(value: unknown) =>
                            Number(value ?? 0) > 0
                              ? `${levelKey}: ${formatNumber(Number(value), 0)}`
                              : ''
                          }
                        />
                        {isTopBar && (
                          <LabelList
                            dataKey="total"
                            position="top"
                            fill="#ffffff"
                            fontSize={11}
                            formatter={(value: unknown) =>
                              `Total: ${formatNumber(Number(value ?? 0), 0)}`
                            }
                          />
                        )}
                      </Bar>
                    )
                  }
                )}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[400px]">
              <div className="animate-pulse bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded w-full h-full"></div>
            </div>
          )}
        </ChartErrorBoundary>
      </div>
    </>
  )
}

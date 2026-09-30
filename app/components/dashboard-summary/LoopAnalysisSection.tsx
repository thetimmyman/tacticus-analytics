'use client'

import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { asNumericTooltipFormatter } from '@tacticus/charting/tooltip'
import type { Dispatch, SetStateAction } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  Legend,
  Bar,
  ComposedChart
} from '@/app/components/RechartsWrapper'
import { formatNumber } from '@tacticus/app-core/formatters'
import { ChartErrorBoundary } from '@/app/components/error'
import {
  LoopExpandableTable,
  LoopFilterChips,
  LoopMobileGrid,
  sortLoopBossNames
} from '@/app/components/loop-analysis/LoopAnalysisScaffold'
import { tooltipStyles } from '@/app/components/dashboard-summary/chart-config'
import { resolveLoopBossLabel } from '@/app/components/dashboard-summary/coerce'

export type DashboardLoopAggregate = {
  loopIndex: number
  bosses: Array<{ name: string; avgDamage: number; isPrime: boolean }>
  totalAvgDamage: number
  avgDamagePerBoss: number
  bossCount: number
  bossTokens: number
  primeTokens: number
  totalTokens: number
  trend: 'improving' | 'declining' | 'stable'
}

interface LoopAnalysisSectionProps {
  dashboardLoopAggregates: DashboardLoopAggregate[]
  selectedDashboardBoss: string | null
  setSelectedDashboardBoss: Dispatch<SetStateAction<string | null>>
  showPrimesOnly: boolean
  setShowPrimesOnly: Dispatch<SetStateAction<boolean>>
  showLoopAnalysisTable: boolean
  setShowLoopAnalysisTable: Dispatch<SetStateAction<boolean>>
  expandedDashboardLoops: Set<number>
  toggleDashboardLoopExpanded: (loopIndex: number) => void
}

export function LoopAnalysisSection({
  dashboardLoopAggregates,
  selectedDashboardBoss,
  setSelectedDashboardBoss,
  showPrimesOnly,
  setShowPrimesOnly,
  showLoopAnalysisTable,
  setShowLoopAnalysisTable,
  expandedDashboardLoops,
  toggleDashboardLoopExpanded
}: LoopAnalysisSectionProps) {
  return (
    <>
      {/* Loop Analysis with Chart and Collapsible Table */}
      {dashboardLoopAggregates.length > 0 && (
        <div className="card-wh40k p-3 sm:p-4">
          <h3 className="subheading-wh40k mb-2">Loop Analysis</h3>
          <p className="text-xs text-secondary-wh40k mb-4">
            Guild average damage by loop
            {selectedDashboardBoss
              ? ` for ${resolveLoopBossLabel(selectedDashboardBoss)}`
              : showPrimesOnly
                ? ' (all primes)'
                : ' (all bosses)'}
          </p>

          <LoopFilterChips
            selectedKey={
              selectedDashboardBoss ??
              (showPrimesOnly ? '__primes__' : '__all__')
            }
            options={[
              { key: '__all__', label: 'All Bosses' },
              { key: '__primes__', label: 'All Primes' },
              ...sortLoopBossNames(
                dashboardLoopAggregates.flatMap((loop) =>
                  loop.bosses.map((boss) => boss.name)
                )
              ).map((bossName) => ({
                key: bossName,
                label: resolveLoopBossLabel(bossName)
              }))
            ]}
            onSelect={(key) => {
              setSelectedDashboardBoss(key.startsWith('__') ? null : key)
              setShowPrimesOnly(key === '__primes__')
            }}
          />

          {/* Chart */}
          <ChartErrorBoundary chartName="Loop Analysis Chart">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={dashboardLoopAggregates.map((loop) => {
                  if (selectedDashboardBoss) {
                    const boss = loop.bosses.find(
                      (b) => b.name === selectedDashboardBoss
                    )
                    return {
                      loop: `Loop ${loop.loopIndex}`,
                      avgDamage: boss?.avgDamage ?? 0,
                      tokens: loop.totalTokens
                    }
                  }
                  if (showPrimesOnly) {
                    const primes = loop.bosses.filter((b) => b.isPrime)
                    const totalPrimeAvg = primes.reduce(
                      (sum, p) => sum + p.avgDamage,
                      0
                    )
                    const avgPerPrime =
                      primes.length > 0 ? totalPrimeAvg / primes.length : 0
                    return {
                      loop: `Loop ${loop.loopIndex}`,
                      totalAvgDamage: totalPrimeAvg,
                      avgDamage: avgPerPrime,
                      tokens: loop.primeTokens
                    }
                  }
                  return {
                    loop: `Loop ${loop.loopIndex}`,
                    totalAvgDamage: loop.totalAvgDamage,
                    avgDamage: loop.avgDamagePerBoss,
                    tokens: loop.totalTokens
                  }
                })}
                margin={{ top: 20, right: 50, left: 20, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--card-border)"
                />
                <XAxis dataKey="loop" tick={DEFAULT_AXIS_STYLES.tick} />
                <YAxis
                  yAxisId="left"
                  tick={DEFAULT_AXIS_STYLES.tick}
                  tickFormatter={(value: number) => formatNumber(value, 0)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={DEFAULT_AXIS_STYLES.tick}
                />
                <Tooltip
                  contentStyle={tooltipStyles}
                  formatter={asNumericTooltipFormatter((value, name) => [
                    value == null
                      ? '—'
                      : name === 'tokens'
                        ? formatNumber(value, 0)
                        : formatNumber(value),
                    name === 'totalAvgDamage'
                      ? 'Total Avg Damage'
                      : name === 'tokens'
                        ? 'Tokens Used'
                        : showPrimesOnly
                          ? 'Avg per Prime'
                          : 'Avg per Boss'
                  ])}
                />
                <Legend />
                <Bar
                  yAxisId="right"
                  dataKey="tokens"
                  name="Tokens Used"
                  fill="#facc15"
                  opacity={0.7}
                />
                {!selectedDashboardBoss && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="totalAvgDamage"
                    name="Total Avg Damage"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ fill: '#10b981' }}
                  />
                )}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="avgDamage"
                  name={
                    selectedDashboardBoss
                      ? 'Avg Damage'
                      : showPrimesOnly
                        ? 'Avg per Prime'
                        : 'Avg per Boss'
                  }
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ fill: '#3b82f6' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>

          {/* Collapsible Table */}
          <button
            type="button"
            onClick={() => setShowLoopAnalysisTable(!showLoopAnalysisTable)}
            className="flex items-center gap-2 mt-4 text-sm text-secondary-wh40k hover:text-(--primary) transition-colors"
          >
            {showLoopAnalysisTable ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {showLoopAnalysisTable ? 'Hide Details' : 'Show Details'}
          </button>

          {showLoopAnalysisTable && (
            <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <LoopExpandableTable
                headers={[
                  'Guild Avg Damage',
                  `Avg per ${showPrimesOnly ? 'Prime' : 'Boss'}`,
                  'Tokens',
                  showPrimesOnly ? 'Primes' : 'Bosses'
                ]}
                expanded={expandedDashboardLoops}
                onToggle={toggleDashboardLoopExpanded}
                rows={dashboardLoopAggregates.map((loop) => {
                  const bosses = showPrimesOnly
                    ? loop.bosses.filter((boss) => boss.isPrime)
                    : loop.bosses
                  const totalAverage = bosses.reduce(
                    (sum, boss) => sum + boss.avgDamage,
                    0
                  )
                  const averagePerBoss =
                    bosses.length > 0 ? totalAverage / bosses.length : 0

                  return {
                    key: loop.loopIndex,
                    loopLabel: `Loop ${loop.loopIndex}`,
                    trend: loop.trend,
                    cells: [
                      {
                        content: formatNumber(
                          showPrimesOnly ? totalAverage : loop.totalAvgDamage
                        ),
                        className: 'font-mono text-green-400'
                      },
                      {
                        content: formatNumber(
                          showPrimesOnly
                            ? averagePerBoss
                            : loop.avgDamagePerBoss
                        ),
                        className: 'font-mono text-blue-400'
                      },
                      {
                        content: formatNumber(
                          showPrimesOnly ? loop.primeTokens : loop.totalTokens
                        ),
                        className: 'font-mono text-yellow-400'
                      },
                      {
                        content: showPrimesOnly ? bosses.length : loop.bossCount
                      }
                    ],
                    detailHeaders: [
                      showPrimesOnly ? 'Prime' : 'Boss',
                      'Avg Damage'
                    ],
                    detailRows: bosses.map((boss) => ({
                      key: `dashboard-loop-${loop.loopIndex}-boss-${boss.name}`,
                      cells: [
                        { content: boss.name },
                        {
                          content: formatNumber(boss.avgDamage),
                          className: 'font-mono text-blue-400'
                        }
                      ]
                    }))
                  }
                })}
              />
              <LoopMobileGrid
                cards={dashboardLoopAggregates.map((loop) => {
                  const bosses = showPrimesOnly
                    ? loop.bosses.filter((boss) => boss.isPrime)
                    : loop.bosses
                  const totalAverage = bosses.reduce(
                    (sum, boss) => sum + boss.avgDamage,
                    0
                  )
                  return {
                    key: loop.loopIndex,
                    title: `Loop ${loop.loopIndex}`,
                    trend: loop.trend,
                    metrics: [
                      {
                        label: 'Guild Avg Dmg',
                        value: formatNumber(totalAverage),
                        className: 'font-mono text-green-400'
                      },
                      {
                        label: `Avg per ${showPrimesOnly ? 'Prime' : 'Boss'}`,
                        value: formatNumber(
                          bosses.length > 0 ? totalAverage / bosses.length : 0
                        ),
                        className: 'font-mono text-blue-400'
                      },
                      {
                        label: 'Tokens',
                        value: formatNumber(
                          showPrimesOnly ? loop.primeTokens : loop.totalTokens
                        ),
                        className: 'font-mono text-yellow-400'
                      },
                      {
                        label: showPrimesOnly ? 'Primes' : 'Bosses',
                        value: bosses.length,
                        className: 'font-mono'
                      }
                    ]
                  }
                })}
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}

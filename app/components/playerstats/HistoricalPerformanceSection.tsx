'use client'

import { DEFAULT_RECHARTS_TOOLTIP_PROPS } from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'

import { useState, type ComponentType } from 'react'
import {
  formatDamage,
  formatNumber,
  formatPercentage,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
  ComposedChart,
  LineChart,
  Line,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis
} from '@/app/components/RechartsWrapper'
import {
  generateTrendlineData,
  formatCAGR,
  formatTrendPerSeason,
  seasonNumberX
} from '@/app/lib/utils/trend-analysis'

type RechartsComponent = ComponentType<Record<string, unknown>>
const AnyLine = Line as unknown as RechartsComponent

export interface HistoricalPerformanceData {
  fiveSeasonAvgGuild: number
  fiveSeasonAvgCluster: number
  radarData: Array<{
    season: string
    vsGuild: number
    vsCluster: number
    clusterRank?: number
    clusterTotal?: number
    guildRank?: number
    guildTotal?: number
    /** MISLEADING NAME: the season's AVERAGE damage per token, not a total. Do not divide again. */
    totalDamage: number
    tokens: number
    reliability: number | null
  }>
}

interface HistoricalPerformanceSectionProps {
  data: HistoricalPerformanceData
  hasValidCluster: boolean
  selectedSeason: string
  guildLabel?: string
  isLoading?: boolean
}

export function HistoricalPerformanceSection({
  data,
  hasValidCluster,
  selectedSeason,
  guildLabel = 'vs Guild',
  isLoading = false
}: HistoricalPerformanceSectionProps) {
  const [mobileViewMode, setMobileViewMode] = useState<'guild' | 'cluster'>(
    'guild'
  )
  const chronologicalData = [...data.radarData].slice().reverse()

  const basePerformanceData = chronologicalData.map((row) => ({
    season: row.season,
    vsGuild: row.vsGuild,
    vsCluster: row.vsCluster,
    tokens: row.tokens,
    totalDamage: row.totalDamage
  }))
  const baseReliabilityData = chronologicalData
    .filter(
      (row) =>
        row.reliability != null && Number.isFinite(row.reliability ?? NaN)
    )
    .map((row) => ({
      season: row.season,
      reliability: row.reliability ?? 0
    }))
  // Already per-token despite the name; null without tokens.
  const baseConsistencyData = chronologicalData.map((row) => ({
    season: row.season,
    avgDamagePerToken:
      row.tokens > 0 && Number.isFinite(row.totalDamage)
        ? row.totalDamage
        : null,
    tokens: row.tokens
  }))

  // Trendlines use x = season number so rates stay honest across history gaps.
  const vsGuildTrend = generateTrendlineData(
    basePerformanceData,
    (d) => d.vsGuild,
    seasonNumberX
  )
  const vsClusterTrend = generateTrendlineData(
    basePerformanceData,
    (d) => d.vsCluster,
    seasonNumberX
  )
  const reliabilityTrend = generateTrendlineData(
    baseReliabilityData,
    (d) => d.reliability,
    seasonNumberX
  )
  const damageTrend = generateTrendlineData(
    baseConsistencyData,
    (d) => d.avgDamagePerToken,
    seasonNumberX
  )

  const performanceTrendData = basePerformanceData.map((row, i) => {
    const n = basePerformanceData.length - 1
    return {
      ...row,
      vsGuildTrend: vsGuildTrend
        ? vsGuildTrend.startY +
          (vsGuildTrend.endY - vsGuildTrend.startY) * (i / Math.max(n, 1))
        : undefined,
      vsClusterTrend: vsClusterTrend
        ? vsClusterTrend.startY +
          (vsClusterTrend.endY - vsClusterTrend.startY) * (i / Math.max(n, 1))
        : undefined
    }
  })
  const reliabilityTrendData = baseReliabilityData.map((row, i) => {
    const n = baseReliabilityData.length - 1
    return {
      ...row,
      reliabilityTrend: reliabilityTrend
        ? reliabilityTrend.startY +
          (reliabilityTrend.endY - reliabilityTrend.startY) *
            (i / Math.max(n, 1))
        : undefined
    }
  })
  const consistencyTrendData = baseConsistencyData.map((row, i) => {
    const n = baseConsistencyData.length - 1
    return {
      ...row,
      damageTrend: damageTrend
        ? damageTrend.startY +
          (damageTrend.endY - damageTrend.startY) * (i / Math.max(n, 1))
        : undefined
    }
  })

  const maxTokenValue = performanceTrendData.reduce((max, row) => {
    const value = Number.isFinite(row.tokens) ? row.tokens : 0
    return value > max ? value : max
  }, 0)

  const tokenAxisMax = Math.max(3, Math.ceil((maxTokenValue + 1) / 1) * 1)
  const maxDamageValue = consistencyTrendData.reduce((max, row) => {
    const value =
      row.avgDamagePerToken != null && Number.isFinite(row.avgDamagePerToken)
        ? row.avgDamagePerToken
        : 0
    return value > max ? value : max
  }, 0)
  const damageAxisMax = Math.max(
    5000,
    Math.ceil((maxDamageValue + 100) / 100) * 100
  )

  return (
    <div className="space-y-4">
      <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-lg chart-card p-4 hover:bg-card/90 hover:shadow-md transition-all duration-250">
        <div className="text-sm font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          Performance Trends (Last 10 Seasons)
          {isLoading && (
            <span className="text-xs animate-pulse">Loading comparison...</span>
          )}
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-64 lg:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart
                  data={data.radarData}
                  margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                >
                  <PolarGrid stroke="var(--card-border)" />
                  <PolarAngleAxis
                    dataKey="season"
                    tick={DEFAULT_AXIS_STYLES.tick}
                  />
                  <PolarRadiusAxis
                    domain={[-50, 50]}
                    tick={DEFAULT_AXIS_STYLES.tick}
                    tickFormatter={(value: number) => `${value}%`}
                  />
                  <Radar
                    name={guildLabel}
                    dataKey="vsGuild"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.3}
                  />
                  {hasValidCluster && (
                    <Radar
                      name="vs Cluster"
                      dataKey="vsCluster"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.3}
                    />
                  )}
                  <Legend
                    wrapperStyle={{ fontSize: '12px' }}
                    iconType="circle"
                  />
                  <Tooltip
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                    formatter={(value: number | undefined, name?: string) => {
                      if (value == null) return ['N/A', name]
                      return [formatPercentage(value / 100), name]
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-[var(--card-bg)] rounded-lg p-3">
              {hasValidCluster && (
                <div className="flex gap-1 mb-2 md:hidden">
                  <button
                    onClick={() => setMobileViewMode('guild')}
                    className={`px-2 py-1 text-xs rounded ${mobileViewMode === 'guild' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--card-border)] text-[var(--text-secondary)]'}`}
                  >
                    Guild
                  </button>
                  <button
                    onClick={() => setMobileViewMode('cluster')}
                    className={`px-2 py-1 text-xs rounded ${mobileViewMode === 'cluster' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--card-border)] text-[var(--text-secondary)]'}`}
                  >
                    Cluster
                  </button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] md:text-xs">
                  <thead>
                    <tr className="border-b border-[var(--card-border)]">
                      <th className="text-left py-2 px-1 text-[var(--text-secondary)] font-medium">
                        Season
                      </th>
                      <th
                        className={`text-right py-2 px-1 text-[var(--text-secondary)] font-medium ${hasValidCluster && mobileViewMode === 'cluster' ? 'hidden md:table-cell' : ''}`}
                      >
                        {guildLabel}
                      </th>
                      <th
                        className={`text-right py-2 px-1 text-[var(--text-secondary)] font-medium ${hasValidCluster && mobileViewMode === 'cluster' ? 'hidden md:table-cell' : ''}`}
                      >
                        Guild Rank
                      </th>
                      {hasValidCluster && (
                        <th
                          className={`text-right py-2 px-1 text-[var(--text-secondary)] font-medium ${mobileViewMode === 'guild' ? 'hidden md:table-cell' : ''}`}
                        >
                          vs Cluster
                        </th>
                      )}
                      {hasValidCluster && (
                        <th
                          className={`text-right py-2 px-1 text-[var(--text-secondary)] font-medium ${mobileViewMode === 'guild' ? 'hidden md:table-cell' : ''}`}
                        >
                          Cluster Rank
                        </th>
                      )}
                      <th className="text-right py-2 px-1 text-[var(--text-secondary)] font-medium">
                        Tokens
                      </th>
                      <th
                        className="text-right py-2 px-1 text-[var(--text-secondary)] font-medium"
                        title="Average damage per token for the season."
                      >
                        Avg Dmg/Token
                      </th>
                      <th className="text-right py-2 px-1 text-[var(--text-secondary)] font-medium hidden md:table-cell">
                        Reliability
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.radarData.map((row) => (
                      <tr
                        key={row.season}
                        className="border-b border-card-border/50"
                      >
                        <td className="py-2 px-1 text-[var(--text-primary)] font-medium">
                          {row.season}
                        </td>
                        <td
                          className={`py-2 px-1 text-right ${row.vsGuild >= 0 ? 'text-green-400' : 'text-red-400'} ${hasValidCluster && mobileViewMode === 'cluster' ? 'hidden md:table-cell' : ''}`}
                        >
                          <span className="md:hidden">
                            {Math.abs(row.vsGuild).toFixed(0)}%
                          </span>
                          <span className="hidden md:inline">
                            {formatPercentageDiff(row.vsGuild, 0)}
                          </span>
                        </td>
                        <td
                          className={`py-2 px-1 text-right text-[var(--text-primary)] ${hasValidCluster && mobileViewMode === 'cluster' ? 'hidden md:table-cell' : ''}`}
                        >
                          {row.guildRank && row.guildTotal ? (
                            <>
                              <span className="md:hidden">
                                #{row.guildRank}
                              </span>
                              <span className="hidden md:inline">
                                #{row.guildRank}/{row.guildTotal}
                              </span>
                            </>
                          ) : (
                            '--'
                          )}
                        </td>
                        {hasValidCluster && (
                          <td
                            className={`py-2 px-1 text-right ${row.vsCluster >= 0 ? 'text-green-400' : 'text-red-400'} ${mobileViewMode === 'guild' ? 'hidden md:table-cell' : ''}`}
                          >
                            <span className="md:hidden">
                              {Math.abs(row.vsCluster).toFixed(0)}%
                            </span>
                            <span className="hidden md:inline">
                              {formatPercentageDiff(row.vsCluster, 0)}
                            </span>
                          </td>
                        )}
                        {hasValidCluster && (
                          <td
                            className={`py-2 px-1 text-right text-[var(--text-primary)] ${mobileViewMode === 'guild' ? 'hidden md:table-cell' : ''}`}
                          >
                            {row.clusterRank && row.clusterTotal ? (
                              <>
                                <span className="md:hidden">
                                  #{row.clusterRank}
                                </span>
                                <span className="hidden md:inline">
                                  #{row.clusterRank}/{row.clusterTotal}
                                </span>
                              </>
                            ) : (
                              '--'
                            )}
                          </td>
                        )}
                        <td className="py-2 px-1 text-right text-[var(--text-primary)]">
                          {row.tokens}
                        </td>
                        <td className="py-2 px-1 text-right text-[var(--text-primary)]">
                          {formatDamage(row.totalDamage)}
                        </td>
                        <td className="py-2 px-1 text-right text-[var(--text-primary)] hidden md:table-cell">
                          {row.reliability != null &&
                          Number.isFinite(row.reliability)
                            ? row.reliability.toFixed(1)
                            : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg chart-card p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                Performance Trend Analysis
              </h4>
              <p className="text-xs text-[var(--text-secondary)]">
                Token usage with performance trends over time.
              </p>
            </div>
            {vsGuildTrend && (
              <div className="text-right text-[10px] space-y-0.5">
                <div
                  className="flex items-center gap-1 justify-end"
                  title="Change per season of the vs-Guild regression trendline, in percentage points."
                >
                  <span className="text-[var(--text-secondary)]">
                    Guild Trend:
                  </span>
                  <span
                    className={
                      vsGuildTrend.slope >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                    }
                  >
                    {formatTrendPerSeason(vsGuildTrend.slope, '%')}
                  </span>
                </div>
                {hasValidCluster && vsClusterTrend && (
                  <div
                    className="flex items-center gap-1 justify-end"
                    title="Change per season of the vs-Cluster regression trendline, in percentage points."
                  >
                    <span className="text-[var(--text-secondary)]">
                      Cluster Trend:
                    </span>
                    <span
                      className={
                        vsClusterTrend.slope >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                      }
                    >
                      {formatTrendPerSeason(vsClusterTrend.slope, '%')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          {performanceTrendData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={performanceTrendData}>
                  <CartesianGrid
                    stroke="var(--card-border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis dataKey="season" tick={DEFAULT_AXIS_STYLES.tick} />
                  <YAxis
                    yAxisId="left"
                    domain={[-50, 50]}
                    tick={DEFAULT_AXIS_STYLES.tick}
                    tickFormatter={(value: number) => `${value}%`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, tokenAxisMax]}
                    tick={DEFAULT_AXIS_STYLES.tick}
                  />
                  <Tooltip
                    formatter={(value: number | undefined, name?: string) => {
                      if (value == null) return ['—', name]
                      if (name === guildLabel) {
                        return [formatPercentage(value / 100), guildLabel]
                      }
                      if (name === 'vs Cluster') {
                        return [formatPercentage(value / 100), 'vs Cluster']
                      }
                      if (name === 'Tokens Used') {
                        return [`${formatNumber(value)}`, 'Tokens Used']
                      }
                      if (name === 'Avg Damage/Token') {
                        return [formatDamage(value), 'Avg Damage/Token']
                      }
                      return [value, name]
                    }}
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="vsGuild"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    name={guildLabel}
                    activeDot={{ r: 4 }}
                  />
                  {vsGuildTrend && (
                    <AnyLine
                      yAxisId="left"
                      type="linear"
                      dataKey="vsGuildTrend"
                      stroke="#10b981"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      dot={false}
                      legendType="none"
                      connectNulls
                    />
                  )}
                  {hasValidCluster && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="vsCluster"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      name="vs Cluster"
                    />
                  )}
                  {hasValidCluster && vsClusterTrend && (
                    <AnyLine
                      yAxisId="left"
                      type="linear"
                      dataKey="vsClusterTrend"
                      stroke="#3b82f6"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      dot={false}
                      legendType="none"
                      connectNulls
                    />
                  )}
                  <Bar
                    yAxisId="right"
                    dataKey="tokens"
                    name="Tokens Used"
                    fill="#f97316"
                    opacity={0.7}
                    radius={[4, 4, 0, 0]}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-xs text-[var(--text-secondary)]">
              Not enough seasonal data to render performance trends.
            </div>
          )}
        </div>

        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg chart-card p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                Reliability Trend Analysis
              </h4>
              <p className="text-xs text-[var(--text-secondary)]">
                Consistency score trends over time (higher = more consistent).
              </p>
            </div>
            {reliabilityTrend && (
              <div className="text-right text-[10px]">
                <div
                  className="flex items-center gap-1 justify-end"
                  title="Change per season of the reliability regression trendline, in score points."
                >
                  <span className="text-[var(--text-secondary)]">Trend:</span>
                  <span
                    className={
                      reliabilityTrend.slope >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                    }
                  >
                    {formatTrendPerSeason(reliabilityTrend.slope)}
                  </span>
                </div>
              </div>
            )}
          </div>
          {reliabilityTrendData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={reliabilityTrendData}>
                  <CartesianGrid
                    stroke="var(--card-border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis dataKey="season" tick={DEFAULT_AXIS_STYLES.tick} />
                  <YAxis
                    domain={[0, 100]}
                    tick={DEFAULT_AXIS_STYLES.tick}
                    tickFormatter={(value: number) => `${value}`}
                  />
                  <Tooltip
                    formatter={(
                      value: number | undefined,
                      name?: string
                    ): [string, string] => [
                      value == null ? '—' : `${value.toFixed(1)}`,
                      name || 'Reliability Score'
                    ]}
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line
                    type="monotone"
                    dataKey="reliability"
                    name="Reliability Score"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  {reliabilityTrend && (
                    <AnyLine
                      type="linear"
                      dataKey="reliabilityTrend"
                      stroke="#7c3aed"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      dot={false}
                      legendType="none"
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-xs text-[var(--text-secondary)]">
              Reliability data unavailable for the selected range.
            </div>
          )}
        </div>
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg chart-card p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">
              Performance Consistency Analysis
            </h4>
            <p className="text-xs text-[var(--text-secondary)]">
              Average damage per token with battle volume by season.
            </p>
          </div>
          {damageTrend && (
            <div className="text-right text-[10px]">
              <div className="flex items-center gap-1 justify-end">
                <span className="text-[var(--text-secondary)]">
                  Damage CAGR:
                </span>
                <span
                  className={
                    damageTrend.cagr !== null && damageTrend.cagr >= 0
                      ? 'text-green-400'
                      : 'text-red-400'
                  }
                >
                  {formatCAGR(damageTrend.cagr)}
                </span>
              </div>
            </div>
          )}
        </div>
        {consistencyTrendData.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={consistencyTrendData}>
                <CartesianGrid
                  stroke="var(--card-border)"
                  strokeDasharray="3 3"
                />
                <XAxis dataKey="season" tick={DEFAULT_AXIS_STYLES.tick} />
                <YAxis
                  yAxisId="left"
                  domain={[0, damageAxisMax]}
                  tick={DEFAULT_AXIS_STYLES.tick}
                  tickFormatter={(value: number) => formatDamage(value, 0)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, tokenAxisMax]}
                  tick={DEFAULT_AXIS_STYLES.tick}
                />
                <Tooltip
                  formatter={(value: number | undefined, name?: string) => {
                    if (value == null) return ['—', name]
                    if (name === 'Avg Damage/Token') {
                      return [formatDamage(value), 'Avg Damage/Token']
                    }
                    if (name === 'Tokens Used') {
                      return [formatNumber(value), 'Tokens Used']
                    }
                    return [value, name]
                  }}
                  contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="avgDamagePerToken"
                  name="Avg Damage/Token"
                  stroke="#facc15"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                {damageTrend && (
                  <AnyLine
                    yAxisId="left"
                    type="linear"
                    dataKey="damageTrend"
                    stroke="#facc15"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    dot={false}
                    legendType="none"
                    connectNulls
                  />
                )}
                <Bar
                  yAxisId="right"
                  dataKey="tokens"
                  name="Tokens Used"
                  fill="#3b82f6"
                  opacity={0.65}
                  radius={[4, 4, 0, 0]}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-xs text-[var(--text-secondary)]">
            Not enough seasonal data to calculate damage consistency.
          </div>
        )}
      </div>

      <div className="flex items-center justify-end text-xs text-[var(--text-secondary)]">
        Current Season: S{selectedSeason}
      </div>
    </div>
  )
}

'use client'

import { DEFAULT_RECHARTS_TOOLTIP_PROPS } from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { useState, useEffect, type ComponentType } from 'react'
import { Card, CardContent } from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { formatNumber, formatDamage } from '@tacticus/app-core/formatters'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from '@/app/components/RechartsWrapper'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  BarChart3
} from 'lucide-react'

type RechartsComponent = ComponentType<Record<string, unknown>>
const AnyLine = Line as unknown as RechartsComponent

interface SeasonSummary {
  season: string
  total_damage: number
  total_attacks: number
  avg_damage_per_attack: number
  bosses_fought: number
  best_boss: string | null
  best_boss_damage: number
}

interface SeasonPerformance {
  season: string
  boss_type: string
  avg_damage: number
  total_damage: number
  total_attacks: number
  best_damage: number
}

interface TrendData {
  direction: 'improving' | 'declining' | 'stable'
  change_pct: number
  cagr: number
  cagr_periods: number
  regression_r2: number
  trendline_points: number[]
  has_enough_data: boolean
}

interface HistoryResponse {
  player_name: string
  guild_code: string
  seasons: SeasonSummary[]
  boss_breakdown: SeasonPerformance[]
  trends: TrendData
  message?: string
}

interface DamageTrendsChartProps {
  playerName: string
  guildCode: string
}

export function DamageTrendsChart({
  playerName,
  guildCode
}: DamageTrendsChartProps) {
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBosses, setSelectedBosses] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'summary' | 'bosses'>('summary')

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          player_name: playerName,
          guild_code: guildCode,
          limit: '10'
        })

        const response = await fetch(`/api/meta/player-history?${params}`)
        const result: HistoryResponse = await response.json()

        if (!response.ok) {
          throw new Error(result.message || 'Failed to fetch history')
        }

        setData(result)

        const bosses = new Set(result.boss_breakdown.map((b) => b.boss_type))
        const topBosses = Array.from(bosses).slice(0, 5)
        setSelectedBosses(new Set(topBosses))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load history')
      } finally {
        setLoading(false)
      }
    }

    if (playerName && guildCode) {
      fetchHistory()
    }
  }, [playerName, guildCode])

  const getTrendIcon = () => {
    if (!data) return null
    switch (data.trends.direction) {
      case 'improving':
        return <TrendingUp className="w-5 h-5 text-green-400" />
      case 'declining':
        return <TrendingDown className="w-5 h-5 text-red-400" />
      default:
        return <Minus className="w-5 h-5 text-[var(--text-secondary)]" />
    }
  }

  const getTrendColor = () => {
    if (!data) return 'text-[var(--text-secondary)]'
    switch (data.trends.direction) {
      case 'improving':
        return 'text-green-400'
      case 'declining':
        return 'text-red-400'
      default:
        return 'text-[var(--text-secondary)]'
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner message="Loading damage trends..." />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="bg-red-500/10 border-red-500/30">
        <CardContent className="py-6">
          <div className="flex items-center gap-3 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data || data.seasons.length === 0) {
    return (
      <Card className="bg-[var(--card-bg)] border-[var(--card-border)]">
        <CardContent className="py-8 text-center">
          <BarChart3 className="w-12 h-12 text-[var(--accent)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            No Historical Data
          </h3>
          <p className="text-[var(--text-secondary)] max-w-md mx-auto">
            We couldn't find enough historical data to show damage trends.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartData = [...data.seasons].reverse().map((s, idx) => ({
    ...s,
    season: `S${s.season}`,
    trendline: data.trends.trendline_points[idx] ?? null
  }))
  const allBosses = Array.from(
    new Set(data.boss_breakdown.map((b) => b.boss_type))
  )

  const rawSeasons = [...data.seasons].reverse()
  const bossChartData = rawSeasons.map((season) => {
    const result: Record<string, any> = { season: `S${season.season}` }

    for (const boss of allBosses) {
      const bossData = data.boss_breakdown.find(
        (b) => b.season === season.season && b.boss_type === boss
      )
      result[boss] = bossData?.avg_damage || null
    }

    return result
  })

  const bossColors = [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#84cc16',
    '#f97316',
    '#6366f1'
  ]

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-blue-500/30">
        <CardContent className="py-3 md:py-4">
          <div className="flex flex-col gap-3 md:gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 md:gap-3 min-w-0">
                {getTrendIcon()}
                <div className="min-w-0">
                  <h4 className="text-sm md:text-base font-medium text-[var(--text-primary)]">
                    Trend:{' '}
                    <span className={getTrendColor()}>
                      {data.trends.direction}
                    </span>
                  </h4>
                  <p className="text-xs md:text-sm text-[var(--text-secondary)]">
                    {data.trends.change_pct > 0 ? '+' : ''}
                    {data.trends.change_pct}% vs previous
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {data.trends.has_enough_data && (
                  <div className="px-2 md:px-3 py-1 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] whitespace-nowrap">
                    <span
                      className={`text-xs md:text-sm font-semibold ${data.trends.cagr >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {data.trends.cagr > 0 ? '+' : ''}
                      {data.trends.cagr}%
                    </span>
                    <span className="text-[10px] md:text-xs text-[var(--text-secondary)] ml-1">
                      CAGR
                    </span>
                  </div>
                )}
                <div className="flex gap-1 md:gap-2">
                  <button
                    onClick={() => setViewMode('summary')}
                    className={`px-2 md:px-3 py-1 text-xs md:text-sm rounded ${
                      viewMode === 'summary'
                        ? 'bg-[var(--primary)] text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    Summary
                  </button>
                  <button
                    onClick={() => setViewMode('bosses')}
                    className={`px-2 md:px-3 py-1 text-xs md:text-sm rounded ${
                      viewMode === 'bosses'
                        ? 'bg-[var(--primary)] text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    By Boss
                  </button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {viewMode === 'summary' && (
        <Card className="bg-[var(--card-bg)] border-[var(--card-border)] chart-card">
          <CardContent className="py-3 md:py-4">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <h4 className="text-xs md:text-sm font-medium text-[var(--text-secondary)]">
                Avg Damage per Attack
              </h4>
              {data.trends.has_enough_data && (
                <span className="text-[10px] md:text-xs text-[var(--text-secondary)]">
                  R² = {data.trends.regression_r2.toFixed(2)}
                </span>
              )}
            </div>
            <div className="h-48 md:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid
                    stroke="var(--card-border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis dataKey="season" tick={DEFAULT_AXIS_STYLES.tick} />
                  <YAxis
                    tick={DEFAULT_AXIS_STYLES.tick}
                    tickFormatter={(v: number) => formatNumber(v)}
                  />
                  <Tooltip
                    formatter={(value: number | undefined, name?: string) => [
                      value == null ? '—' : formatNumber(value),
                      name === 'trendline' ? 'Trendline' : 'Avg Damage'
                    ]}
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="avg_damage_per_attack"
                    name="Avg Damage/Attack"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  {data.trends.has_enough_data && (
                    <AnyLine
                      type="linear"
                      dataKey="trendline"
                      name="Trendline"
                      stroke={data.trends.cagr >= 0 ? '#22c55e' : '#ef4444'}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      legendType="line"
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 md:mt-6">
              <h4 className="text-xs md:text-sm font-medium text-[var(--text-secondary)] mb-3 md:mb-4">
                Total Damage by Season
              </h4>
              <div className="h-40 md:h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid
                      stroke="var(--card-border)"
                      strokeDasharray="3 3"
                    />
                    <XAxis dataKey="season" tick={DEFAULT_AXIS_STYLES.tick} />
                    <YAxis
                      tick={DEFAULT_AXIS_STYLES.tick}
                      tickFormatter={(v: number) => formatDamage(v, 0)}
                    />
                    <Tooltip
                      formatter={(value: number | undefined) => [
                        value == null ? '—' : formatDamage(value),
                        'Total Damage'
                      ]}
                      contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                    />
                    <Bar
                      dataKey="total_damage"
                      name="Total Damage"
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {viewMode === 'bosses' && (
        <Card className="bg-[var(--card-bg)] border-[var(--card-border)] chart-card">
          <CardContent className="py-3 md:py-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3 md:mb-4">
              <h4 className="text-xs md:text-sm font-medium text-[var(--text-secondary)]">
                Avg Damage by Boss
              </h4>
              <div className="flex flex-wrap gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
                {allBosses.map((boss, idx) => (
                  <button
                    key={boss}
                    onClick={() => {
                      const newSelected = new Set(selectedBosses)
                      if (newSelected.has(boss)) {
                        newSelected.delete(boss)
                      } else {
                        newSelected.add(boss)
                      }
                      setSelectedBosses(newSelected)
                    }}
                    className={`px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs rounded transition-colors flex-shrink-0 ${
                      selectedBosses.has(boss)
                        ? 'text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }`}
                    style={{
                      backgroundColor: selectedBosses.has(boss)
                        ? bossColors[idx % bossColors.length]
                        : undefined
                    }}
                  >
                    {getBossDisplayName(boss).slice(0, 6)}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-64 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={bossChartData}>
                  <CartesianGrid
                    stroke="var(--card-border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis dataKey="season" tick={DEFAULT_AXIS_STYLES.tick} />
                  <YAxis
                    tick={DEFAULT_AXIS_STYLES.tick}
                    tickFormatter={(v: number) => formatNumber(v)}
                  />
                  <Tooltip
                    formatter={(value: number | undefined, name?: string) => [
                      value == null ? 'N/A' : formatNumber(value),
                      name
                    ]}
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                  />
                  <Legend />
                  {allBosses.map(
                    (boss, idx) =>
                      selectedBosses.has(boss) && (
                        <Line
                          key={boss}
                          type="monotone"
                          dataKey={boss}
                          name={getBossDisplayName(boss)}
                          stroke={bossColors[idx % bossColors.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      )
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-[var(--card-bg)] border-[var(--card-border)]">
        <CardContent className="py-3">
          <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
            Season Details
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--card-border)]">
                  <th className="text-left py-2 px-2 text-[var(--text-secondary)]">
                    Season
                  </th>
                  <th className="text-right py-2 px-2 text-[var(--text-secondary)]">
                    Total Damage
                  </th>
                  <th className="text-right py-2 px-2 text-[var(--text-secondary)]">
                    Attacks
                  </th>
                  <th className="text-right py-2 px-2 text-[var(--text-secondary)]">
                    Avg/Attack
                  </th>
                  <th className="text-right py-2 px-2 text-[var(--text-secondary)]">
                    Bosses
                  </th>
                  <th className="text-left py-2 px-2 text-[var(--text-secondary)]">
                    Best Boss
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.seasons.map((season) => (
                  <tr
                    key={season.season}
                    className="border-b border-card-border/50"
                  >
                    <td className="py-2 px-2 text-[var(--text-primary)] font-medium">
                      S{season.season}
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--text-primary)]">
                      {formatDamage(season.total_damage)}
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--text-primary)]">
                      {season.total_attacks}
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--accent)]">
                      {formatNumber(season.avg_damage_per_attack)}
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--text-primary)]">
                      {season.bosses_fought}
                    </td>
                    <td className="py-2 px-2 text-[var(--text-secondary)]">
                      {season.best_boss || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

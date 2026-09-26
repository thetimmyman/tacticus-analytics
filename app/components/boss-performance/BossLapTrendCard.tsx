'use client'

import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from '@/app/components/RechartsWrapper'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import {
  MechanicusEmptyState as EmptyState,
  TableSkeleton
} from '@tacticus/ui-kit/loading'
import { formatDamage, formatNumber } from '@tacticus/app-core/formatters'
import { getTooltipStyles } from '@tacticus/charting/tooltip'
import { BarChart3, Table2, ChevronDown, ChevronRight } from 'lucide-react'
import { useBossLapTrends } from '@/app/components/boss-performance/hooks/useBossPerformanceData'
import { TrendBadge } from '@/app/components/ui/TrendBadge'
import { usePlayerDamageByLoopForBoss } from '@/app/lib/hooks/queries'

const tooltipStyles = getTooltipStyles().contentStyle

interface LoopAggregate {
  lap: number
  avgDamage: number
  tokenCount: number
  trend: 'improving' | 'declining' | 'stable'
}

function LoopPlayerDetails({
  loopIndex,
  guildCode,
  season,
  bossName,
  level
}: {
  loopIndex: number
  guildCode: string
  season: string
  bossName: string
  level: string
}) {
  const {
    data: playerData,
    isLoading,
    error: _error
  } = usePlayerDamageByLoopForBoss(guildCode, season, bossName, level, {
    enabled: true
  })

  const loopPlayers = useMemo(() => {
    if (!playerData) return []
    return playerData.filter((p) => p.loopIndex === loopIndex)
  }, [playerData, loopIndex])

  if (isLoading) {
    return (
      <tr>
        <td colSpan={5} className="px-4 py-2">
          <div className="text-xs text-[var(--text-secondary)] animate-pulse">
            Loading player data...
          </div>
        </td>
      </tr>
    )
  }

  if (loopPlayers.length === 0) {
    return (
      <tr>
        <td colSpan={5} className="px-4 py-2">
          <div className="text-xs text-[var(--text-secondary)]">
            No player data available
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td colSpan={5} className="p-0">
        <div className="bg-card/30 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <table className="w-full text-xs border-collapse">
            <thead className="text-[var(--text-secondary)] uppercase bg-card/50">
              <tr>
                <th className="px-3 py-2 text-left">Player</th>
                <th className="px-3 py-2 text-right">Avg Damage</th>
                <th className="px-3 py-2 text-right">Max Hit</th>
                <th className="px-3 py-2 text-right">Total Damage</th>
                <th className="px-3 py-2 text-right">Hits</th>
              </tr>
            </thead>
            <tbody>
              {loopPlayers.map((player) => (
                <tr
                  key={player.displayName}
                  className="border-b border-card-border/30 hover:bg-[color-mix(in_srgb,var(--card-hover)_50%,transparent)] transition-colors"
                >
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                    {player.displayName}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-blue-400">
                    {formatNumber(player.avgDamage)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatNumber(player.maxDamage)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-yellow-400">
                    {formatNumber(player.totalDamage)}
                  </td>
                  <td className="px-3 py-2 text-right">{player.hitCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  )
}

export function BossLapTrendCard() {
  const {
    lapTrends,
    loading,
    error,
    selectedGuild,
    selectedSeason,
    bossName,
    level
  } = useBossLapTrends()
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')
  const [expandedLoops, setExpandedLoops] = useState<Set<number>>(new Set())

  const toggleLoop = (lap: number) => {
    setExpandedLoops((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(lap)) {
        newSet.delete(lap)
      } else {
        newSet.add(lap)
      }
      return newSet
    })
  }

  const loopAggregates = useMemo<LoopAggregate[]>(() => {
    if (!lapTrends || lapTrends.length === 0) return []

    // Copy before sort: the React Query result is frozen in production.
    return [...lapTrends]
      .sort((a, b) => a.lap - b.lap)
      .map((lap, index, arr) => {
        const prev = arr[index - 1]
        const trend: 'improving' | 'declining' | 'stable' = !prev
          ? 'stable'
          : lap.avgDamage > prev.avgDamage * 1.05
            ? 'improving'
            : lap.avgDamage < prev.avgDamage * 0.95
              ? 'declining'
              : 'stable'
        return { ...lap, trend }
      })
  }, [lapTrends])

  const renderChart = () => (
    <ResponsiveContainer width="100%" height={220} minHeight={200}>
      <ComposedChart data={lapTrends}>
        <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
        <XAxis
          dataKey="lap"
          tick={DEFAULT_AXIS_STYLES.tick}
          axisLine={{ stroke: '#64748b' }}
        />
        <YAxis
          yAxisId="left"
          tick={DEFAULT_AXIS_STYLES.tick}
          axisLine={{ stroke: '#64748b' }}
          tickFormatter={(value: number) => `${formatDamage(value)}`}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={DEFAULT_AXIS_STYLES.tick}
          axisLine={{ stroke: '#64748b' }}
        />
        <Tooltip
          contentStyle={tooltipStyles}
          formatter={(value: number | undefined, name?: string) => [
            value == null
              ? '—'
              : name === 'Avg Damage'
                ? `${formatDamage(value)}`
                : formatNumber(value),
            name === 'Avg Damage' ? 'Avg Damage' : 'Token Count'
          ]}
        />
        <Legend />
        <Bar
          yAxisId="right"
          dataKey="tokenCount"
          fill="#F59E0B"
          name="Token Count"
          opacity={0.7}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="avgDamage"
          stroke="#10B981"
          strokeWidth={3}
          name="Avg Damage"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )

  const renderTable = () => (
    <>
      {/* Desktop Table */}
      <div className="hidden lg:block">
        <div className="overflow-x-auto border border-[var(--card-border)] rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--card-bg)]">
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                <th className="px-2 py-2 w-8"></th>
                <th className="px-4 py-2">Loop</th>
                <th className="px-4 py-2 text-right">Avg Damage</th>
                <th className="px-4 py-2 text-right">Tokens Used</th>
                <th className="px-4 py-2 text-center">Trend</th>
              </tr>
            </thead>
            <tbody>
              {loopAggregates.map((loop) => {
                const isExpanded = expandedLoops.has(loop.lap)
                return (
                  <>
                    <tr
                      key={`loop-${loop.lap}`}
                      className="border-t border-card-border/60 cursor-pointer hover:bg-card/50 transition-colors"
                      onClick={() => toggleLoop(loop.lap)}
                    >
                      <td className="px-2 py-2 text-[var(--text-secondary)]">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                        Loop {loop.lap}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-blue-400">
                        {formatDamage(loop.avgDamage)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-yellow-400">
                        {formatNumber(loop.tokenCount)}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <TrendBadge trend={loop.trend} />
                      </td>
                    </tr>
                    {isExpanded &&
                      selectedGuild &&
                      selectedSeason &&
                      bossName &&
                      level && (
                        <LoopPlayerDetails
                          key={`loop-${loop.lap}-players`}
                          loopIndex={loop.lap}
                          guildCode={selectedGuild}
                          season={selectedSeason}
                          bossName={bossName}
                          level={level}
                        />
                      )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          Click on a loop to see player breakdowns
        </p>
      </div>
      {/* Mobile Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden">
        {loopAggregates.map((loop) => (
          <div
            key={`loop-card-${loop.lap}`}
            className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Loop {loop.lap}
              </div>
              <TrendBadge
                trend={loop.trend}
                showLabel={false}
                className="flex items-center gap-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Avg Damage
                </div>
                <div className="text-blue-400 font-mono">
                  {formatDamage(loop.avgDamage)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Tokens
                </div>
                <div className="text-yellow-400 font-mono">
                  {formatNumber(loop.tokenCount)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )

  const renderBody = () => {
    if (loading) {
      return <TableSkeleton rows={4} columns={4} />
    }

    if (error) {
      return (
        <EmptyState
          title="Lap trends unavailable"
          description="We couldn't render lap damage trends right now. Please retry in a moment."
        />
      )
    }

    if (lapTrends.length === 0) {
      return (
        <EmptyState
          title="No lap trend data"
          description="Once enough loops are logged for this boss, we'll plot the average damage per lap here."
        />
      )
    }

    return viewMode === 'chart' ? renderChart() : renderTable()
  }

  return (
    <Card className="card-wh40k chart-card">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="subheading-wh40k text-green-400 text-base sm:text-lg">
            AVG Damage per Loop
          </CardTitle>
          {lapTrends.length > 0 && (
            <div className="flex items-center gap-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-1">
              <button
                type="button"
                onClick={() => setViewMode('chart')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'chart'
                    ? 'bg-[var(--primary)] text-[var(--bg-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title="Chart view"
              >
                <BarChart3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'table'
                    ? 'bg-[var(--primary)] text-[var(--bg-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title="Table view"
              >
                <Table2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">{renderBody()}</CardContent>
    </Card>
  )
}

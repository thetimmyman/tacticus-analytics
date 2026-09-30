'use client'

import {
  DEFAULT_RECHARTS_TOOLTIP_PROPS,
  asNumericTooltipFormatter
} from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { BarChart3 } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from '@/app/components/RechartsWrapper'
import { TrendingTeamsGrid } from './TrendingTeams'

interface MetaTrend {
  meta_team: string
  current_season: string
  previous_season: string
  current_avg_p90: number
  previous_avg_p90: number
  current_usage: number
  previous_usage: number
  damage_delta: number
  damage_delta_pct: number
  usage_delta: number
  usage_delta_pct: number
  trend: 'rising' | 'falling' | 'stable'
}

interface OffMetaGem {
  team_hash: string
  team_composition: string
  meta_team: string | null
  boss_type: string
  rarity: string
  damage_p90: number
  attack_count: number
  efficiency_score: number
}

interface TrendsData {
  current_season: string
  previous_season: string
  rarity: string | null
  rarity_set: string | null
  trends: MetaTrend[]
  rising_stars: MetaTrend[]
  falling_off: MetaTrend[]
  off_meta_gems: OffMetaGem[]
  error?: string
}

interface MetaTrendsProps {
  currentSeason: string
  previousSeason: string
  raritySet: string
}

function TrendsComparisonChart({ trends }: { trends: MetaTrend[] }) {
  const chartData = useMemo(
    () =>
      trends
        .filter((t) => t.current_avg_p90 > 0 && t.previous_avg_p90 > 0)
        .slice(0, 8)
        .map((t) => ({
          name: t.meta_team,
          current: Math.round(t.current_avg_p90),
          previous: Math.round(t.previous_avg_p90),
          delta: t.damage_delta_pct
        })),
    [trends]
  )

  if (chartData.length === 0) return null

  const truncateName = (name: string, maxLength: number) => {
    if (name.length <= maxLength) return name
    return name.substring(0, maxLength - 1) + '…'
  }

  return (
    <Card className="bg-(--card-bg) border-(--card-border) chart-card w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-purple-400" />
          Season-over-Season P90 Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ left: 0, right: 8, top: 5, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--card-border)"
                horizontal
                vertical={false}
              />
              <XAxis
                type="number"
                tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                tick={DEFAULT_AXIS_STYLES.tick}
                axisLine={{ stroke: 'var(--card-border)' }}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={DEFAULT_AXIS_STYLES.tick}
                width={90}
                tickFormatter={(name) => truncateName(name, 14)}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={asNumericTooltipFormatter((value, name) => [
                  value == null ? '—' : formatNumber(value),
                  name === 'current' ? 'Current Season' : 'Previous Season'
                ])}
                labelFormatter={(label) =>
                  chartData.find((d) => d.name === label)?.name || label
                }
                contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
              />
              <Legend wrapperStyle={{ paddingTop: '8px' }} />
              <Bar
                dataKey="previous"
                name="Previous"
                fill="#6b7280"
                radius={[0, 4, 4, 0]}
              />
              <Bar
                dataKey="current"
                name="Current"
                fill="#8b5cf6"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

export function MetaTrends({
  currentSeason,
  previousSeason,
  raritySet
}: MetaTrendsProps) {
  const [trends, setTrends] = useState<TrendsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentSeason || !previousSeason) return

    const params = new URLSearchParams({
      current_season: currentSeason,
      previous_season: previousSeason
    })
    if (raritySet) params.set('rarity_set', raritySet)

    fetch(`/api/meta/trends?${params}`)
      .then((res) => res.json())
      .then((data) => {
        setTrends(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [currentSeason, previousSeason, raritySet])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (!trends || trends.error) {
    return (
      <Card className="bg-(--card-bg) border-(--card-border)">
        <CardContent className="py-8 text-center text-gray-400">
          Unable to load meta trends. Try again later.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-400">
        Comparing Season {previousSeason} → Season {currentSeason}
        {raritySet && ` (${raritySet})`}
      </div>

      {trends.trends.length > 0 && (
        <TrendsComparisonChart trends={trends.trends} />
      )}

      <TrendingTeamsGrid
        risingStars={trends.rising_stars || []}
        fallingOff={trends.falling_off || []}
        offMetaGems={trends.off_meta_gems || []}
        showOffMeta={true}
      />
    </div>
  )
}

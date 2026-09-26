'use client'

import { DEFAULT_RECHARTS_TOOLTIP_PROPS } from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Database, Loader2 } from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList
} from '@/app/components/RechartsWrapper'

interface PlatformSummary {
  registered_users: number
  clusters_with_guilds: number
  distinct_guilds_battle: number
  player_mappings: number
  distinct_players_battle: number
  boss_battle_records: number
  guild_war_battles: number
}

// Largest first, so it renders at the top.
const METRIC_ORDER: {
  key: keyof PlatformSummary
  label: string
  color: string
}[] = [
  {
    key: 'boss_battle_records',
    label: 'Boss battle records',
    color: '#ef4444'
  },
  { key: 'guild_war_battles', label: 'Guild war battles', color: '#14b8a6' },
  {
    key: 'distinct_players_battle',
    label: 'Distinct players (battle data)',
    color: '#ec4899'
  },
  { key: 'player_mappings', label: 'Player mappings', color: '#f59e0b' },
  { key: 'registered_users', label: 'Registered users', color: '#a855f7' },
  {
    key: 'distinct_guilds_battle',
    label: 'Distinct guilds (battle data)',
    color: '#22c55e'
  },
  {
    key: 'clusters_with_guilds',
    label: 'Clusters (with guilds)',
    color: '#3b82f6'
  }
]

// Deterministic separator; avoids toLocaleString's hydration lint (integer counts).
const fmt = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// ISO-8601 UTC string; rendered without a locale.
const formatTimestamp = (iso: string) => {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]} UTC` : iso
}

export function PlatformSummaryChart() {
  const [data, setData] = useState<PlatformSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/admin/platform-summary')
        if (!res.ok) {
          throw new Error('Failed to load platform summary')
        }
        const json = await res.json()
        if (!active) return
        setData(json.summary as PlatformSummary)
        setCachedAt((json.cachedAt as string | undefined) ?? null)
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unknown error')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [])

  const bars = data
    ? METRIC_ORDER.map((m) => ({
        key: m.key,
        label: m.label,
        value: data[m.key],
        color: m.color
      }))
    : []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Production Database Summary
          </CardTitle>
          {cachedAt && (
            <span className="text-xs text-[var(--text-tertiary)]">
              as of {formatTimestamp(cachedAt)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-[340px]">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-400">{error}</p>
        ) : (
          <>
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={bars}
                  layout="vertical"
                  margin={{ top: 8, right: 96, bottom: 8, left: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--card-border)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    scale="log"
                    domain={[1, 'dataMax']}
                    allowDataOverflow
                    tick={DEFAULT_AXIS_STYLES.tick}
                    tickFormatter={(value) => fmt(Number(value))}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={DEFAULT_AXIS_STYLES.tick}
                    width={190}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                    formatter={(value: number | undefined) => [
                      fmt(Number(value ?? 0)),
                      'Count'
                    ]}
                  />
                  <Bar
                    dataKey="value"
                    fill="#3b82f6"
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                  >
                    {bars.map((b) => (
                      <Cell key={b.key} fill={b.color} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      fill="var(--text-primary)"
                      fontSize={11}
                      fontWeight="bold"
                      formatter={(value: unknown) => fmt(Number(value ?? 0))}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-[var(--text-tertiary)]">
              Log scale — bar lengths span orders of magnitude. Distinct counts
              are computed over the full battle-records table; values cache for
              5 minutes.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

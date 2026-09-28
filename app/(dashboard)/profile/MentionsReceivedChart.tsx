'use client'

import { DEFAULT_RECHARTS_TOOLTIP_PROPS } from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell
} from '@/app/components/RechartsWrapper'

interface MentionEntry {
  role: string
  count: number
}

const BAR_COLORS = [
  'var(--accent)',
  'var(--primary)',
  '#8b5cf6',
  '#f59e0b',
  '#10b981',
  '#ef4444'
]

export function MentionsReceivedChart() {
  const [data, setData] = useState<MentionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/player/mentions-received')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => setData(json.mentions ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="h-48 rounded-lg bg-(--card-bg) animate-pulse border border-(--card-border)" />
    )
  }

  if (error) {
    return (
      <p className="text-sm text-secondary-wh40k">
        Unable to load mention data.
      </p>
    )
  }

  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <p className="text-sm text-secondary-wh40k">
        No notifications received in the last 7 days.
      </p>
    )
  }

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 0, right: 16, top: 4, bottom: 4 }}
        >
          <XAxis type="number" tick={DEFAULT_AXIS_STYLES.tick} />
          <YAxis
            type="category"
            dataKey="role"
            width={120}
            tick={DEFAULT_AXIS_STYLES.tick}
          />
          <Tooltip
            contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
            formatter={(value: number | undefined) => [
              value == null ? '—' : `${value} mention${value !== 1 ? 's' : ''}`,
              'Count'
            ]}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.role}
                fill={BAR_COLORS[data.indexOf(entry) % BAR_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

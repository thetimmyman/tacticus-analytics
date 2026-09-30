'use client'

import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import type { GuildVsClusterBossRow } from '@/app/lib/calculations/experimental/guild-vs-cluster'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { formatPercentageDiff } from '@tacticus/app-core/formatters'
import {
  getTooltipStyles,
  asNumericTooltipFormatter
} from '@tacticus/charting/tooltip'
import { getBossLevelFromSetAndRarity } from '@/app/lib/catalogs/rarity-set'
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip
} from '@/app/components/RechartsWrapper'

const tooltipStyles = getTooltipStyles().contentStyle

interface GuildVsClusterRadarProps {
  data: GuildVsClusterBossRow[]
  season: string
}

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const buildDomain = (values: number[]): [number, number] => {
  const maxAbs = Math.max(
    20,
    Math.ceil(Math.max(...values.map((v) => Math.abs(v))) / 10) * 10 || 50
  )
  return [-maxAbs, maxAbs]
}

type RadiusTickProps = {
  payload?: { value?: unknown }
  x?: number
  y?: number
  textAnchor?: 'start' | 'middle' | 'end' | 'inherit'
}

const RadiusTick = ({ payload, x = 0, y = 0, textAnchor }: RadiusTickProps) => {
  const v = toNumber(payload?.value)
  const color = v === 0 ? '#facc15' : v > 0 ? '#22c55e' : '#f87171'
  const label = `${v > 0 ? '+' : ''}${Math.round(v)}%`
  return (
    <text x={x} y={y} textAnchor={textAnchor} fill={color} fontSize={10}>
      {label}
    </text>
  )
}

export function GuildVsClusterRadar({
  data,
  season
}: GuildVsClusterRadarProps) {
  const bossDataRaw = data.filter((item) => item.encounter_type === 'Boss')

  if (bossDataRaw.length === 0) return null

  const bossValues = bossDataRaw.map((item) =>
    toNumber(item.vs_cluster_percent)
  )
  const domain = buildDomain(bossValues.length ? bossValues : [0])

  const bossData = bossDataRaw.map((item) => {
    const set = typeof item.set === 'number' ? item.set : 0
    const rarity =
      typeof item.rarity === 'string' && item.rarity ? item.rarity : 'Legendary'
    const levelLabel = getBossLevelFromSetAndRarity(set, rarity)
    return {
      // Main-boss rows only; boss_name is the raw boss_type, so resolve the display name.
      subject: `${levelLabel} ${getBossDisplayName(item.boss_name)}`,
      guild: toNumber(item.vs_cluster_percent),
      cluster: 0
    }
  })

  return (
    <div className="card-wh40k chart-card p-4">
      <h3 className="heading-wh40k">Guild vs Cluster (Season {season})</h3>
      <p className="text-xs text-secondary-wh40k mb-4">
        Guild average vs cluster average for legendary and mythic bosses
      </p>
      <ResponsiveContainer width="100%" height={400}>
        <RadarChart data={bossData}>
          <PolarGrid stroke="#475569" />
          <PolarAngleAxis dataKey="subject" tick={DEFAULT_AXIS_STYLES.tick} />
          <PolarRadiusAxis angle={90} domain={domain} tick={<RadiusTick />} />
          <Radar
            name="Guild Performance"
            dataKey="guild"
            stroke="#3B82F6"
            fill="#3B82F6"
            fillOpacity={0.4}
            strokeWidth={2}
          />
          <Radar
            name="Cluster Average"
            dataKey="cluster"
            stroke="#F59E0B"
            fill="#F59E0B"
            fillOpacity={0.2}
            strokeWidth={2}
            strokeDasharray="5 5"
          />
          <Legend wrapperStyle={{ color: '#cbd5e1' }} />
          <Tooltip
            contentStyle={tooltipStyles}
            formatter={asNumericTooltipFormatter((value, name) => {
              if (name === 'Guild Performance') {
                return [
                  value == null
                    ? '—'
                    : `${formatPercentageDiff(value, 0)} vs Cluster`,
                  name ?? ''
                ]
              }
              return ['Baseline (0%)', name ?? '']
            })}
          />
        </RadarChart>
      </ResponsiveContainer>
      <div className="mt-4 text-xs text-secondary-wh40k">
        <p>Positive values indicate guild performance above cluster average</p>
      </div>
    </div>
  )
}

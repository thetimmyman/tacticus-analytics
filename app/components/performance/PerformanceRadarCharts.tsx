'use client'

import {
  DEFAULT_RECHARTS_TOOLTIP_PROPS,
  asNumericTooltipFormatter
} from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { getBossLevelFromSetAndRarity } from '@/app/lib/catalogs/rarity-set'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { formatPercentageDiff } from '@tacticus/app-core/formatters'
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  Legend
} from '@/app/components/RechartsWrapper'
import { useGuildDisplayLabel } from '@/app/lib/hooks/useGuildDisplayLabel'

export interface GuildVsClusterPerformance {
  encounter_type: string
  boss_name: string
  vs_cluster_percent: number
  set?: number | null
  rarity?: string | null
}

interface PerformanceRadarChartsProps {
  hasCluster: boolean
  selectedGuild: string
  data: GuildVsClusterPerformance[]
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

export function PerformanceRadarCharts({
  hasCluster,
  selectedGuild,
  data
}: PerformanceRadarChartsProps) {
  const guildDisplayLabel = useGuildDisplayLabel(selectedGuild)

  if (!hasCluster || data.length === 0) {
    return null
  }

  const bossDataRaw = data.filter((item) => item.encounter_type === 'Boss')
  const primesDataRaw = data.filter((item) => item.encounter_type === 'Prime')

  const bossValues = bossDataRaw.map((item) =>
    toNumber(item.vs_cluster_percent)
  )
  const primeValues = primesDataRaw.map((item) =>
    toNumber(item.vs_cluster_percent)
  )
  const bossDomain = buildDomain(bossValues.length ? bossValues : [0])
  const primeDomain = buildDomain(primeValues.length ? primeValues : [0])

  const bossData = bossDataRaw.map((item) => {
    const set = typeof item.set === 'number' ? item.set : 0
    const rarity =
      typeof item.rarity === 'string' && item.rarity ? item.rarity : 'Legendary'
    const levelLabel = getBossLevelFromSetAndRarity(set, rarity)
    return {
      // Main rows hold the raw boss_type; resolve it. Prime rows already hold real names;
      // resolving them would collapse variant primes onto their main.
      subject: `${levelLabel} ${getBossDisplayName(item.boss_name)}`,
      guild: toNumber(item.vs_cluster_percent),
      cluster: 0
    }
  })

  const primesData = primesDataRaw.map((item) => {
    const set = typeof item.set === 'number' ? item.set : 0
    const rarity =
      typeof item.rarity === 'string' && item.rarity ? item.rarity : 'Legendary'
    const levelLabel = getBossLevelFromSetAndRarity(set, rarity)
    return {
      subject: `${levelLabel} ${item.boss_name}`,
      guild: toNumber(item.vs_cluster_percent),
      cluster: 0
    }
  })

  return (
    <>
      {bossData.length > 0 && (
        <div className="card-wh40k chart-card p-4">
          <h3 className="heading-wh40k">Boss Performance Comparison</h3>
          <p className="text-xs text-secondary-wh40k mb-4">
            {guildDisplayLabel} guild average vs cluster average for all
            legendary and mythic bosses
          </p>
          <ResponsiveContainer width="100%" height={400}>
            <RadarChart data={bossData}>
              <PolarGrid stroke="#475569" />
              <PolarAngleAxis
                dataKey="subject"
                tick={DEFAULT_AXIS_STYLES.tick}
              />
              <PolarRadiusAxis
                angle={90}
                domain={bossDomain}
                tick={<RadiusTick />}
              />
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
                contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
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
            <p>
              Positive values indicate guild performance above cluster average
            </p>
            <p>
              Negative values indicate guild performance below cluster average
            </p>
          </div>
        </div>
      )}

      {primesData.length > 0 && (
        <div className="card-wh40k chart-card p-4">
          <h3 className="heading-wh40k">Prime Performance Comparison</h3>
          <p className="text-xs text-secondary-wh40k mb-4">
            {guildDisplayLabel} guild average vs cluster average for all
            legendary and mythic primes
          </p>
          <ResponsiveContainer width="100%" height={400}>
            <RadarChart data={primesData}>
              <PolarGrid stroke="#475569" />
              <PolarAngleAxis
                dataKey="subject"
                tick={DEFAULT_AXIS_STYLES.tick}
              />
              <PolarRadiusAxis
                angle={90}
                domain={primeDomain}
                tick={<RadiusTick />}
              />
              <Radar
                name="Guild Performance"
                dataKey="guild"
                stroke="#9333EA"
                fill="#9333EA"
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
                contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
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
            <p>
              Positive values indicate guild performance above cluster average
            </p>
            <p>
              Negative values indicate guild performance below cluster average
            </p>
          </div>
        </div>
      )}
    </>
  )
}

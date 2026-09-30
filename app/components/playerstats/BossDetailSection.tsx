'use client'

import {
  DEFAULT_RECHARTS_TOOLTIP_PROPS,
  asNumericTooltipFormatter
} from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'

import { useState } from 'react'
import { VS_GUILD_NA } from './hooks/useGuildComparisonOverlay'
import {
  usePlayerDamageByBossLoop,
  useDamageByBossLoop
} from '@/app/lib/hooks/queries'
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
import { getBossLevelFromSetAndRarity } from '@/app/lib/catalogs/rarity-set'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type { BossStatDetail } from './types'
import { BossPerformanceTable } from './boss-detail/BossPerformanceTable'
import { LoopAnalysisSection } from './boss-detail/LoopAnalysisSection'

interface BossDetailSectionProps {
  bossStats: Record<string, BossStatDetail>
  primeStats: Record<string, BossStatDetail>
  hasValidCluster: boolean
  playerName: string
  guildCode?: string
  season?: string
  guildLabel?: string
}

type RadiusTickProps = {
  payload?: { value?: unknown }
  x?: number
  y?: number
  textAnchor?: 'start' | 'middle' | 'end' | 'inherit'
}

const RadiusTick = ({ payload, x = 0, y = 0, textAnchor }: RadiusTickProps) => {
  const raw = typeof payload?.value === 'number' ? payload.value : 50
  const diff = raw - 50
  const color = diff === 0 ? '#facc15' : diff > 0 ? '#22c55e' : '#f87171'
  const label =
    diff === 0 ? 'Avg' : `${diff > 0 ? '+' : ''}${Math.round(diff)}%`
  return (
    <text x={x} y={y} textAnchor={textAnchor} fill={color} fontSize={10}>
      {label}
    </text>
  )
}

export function BossDetailSection({
  bossStats,
  primeStats,
  hasValidCluster,
  playerName,
  guildCode,
  season,
  guildLabel = 'vs Guild'
}: BossDetailSectionProps) {
  const [expandedBosses, setExpandedBosses] = useState<Set<string>>(new Set())
  const [expandedLoops, setExpandedLoops] = useState<Set<number>>(new Set())
  const [loopAnalysisView, setLoopAnalysisView] = useState<'table' | 'chart'>(
    'table'
  )
  const [selectedLoopBoss, setSelectedLoopBoss] = useState<string | null>(null)
  const { data: loopData } = usePlayerDamageByBossLoop(
    guildCode ?? '',
    season ?? '',
    playerName,
    { enabled: Boolean(guildCode && season && playerName) }
  )

  const { data: guildLoopData } = useDamageByBossLoop(
    guildCode ?? '',
    season ?? '',
    { enabled: Boolean(guildCode && season) }
  )

  const toggleBossExpanded = (bossKey: string) => {
    setExpandedBosses((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(bossKey)) {
        newSet.delete(bossKey)
      } else {
        newSet.add(bossKey)
      }
      return newSet
    })
  }

  const toggleLoopExpanded = (loopIndex: number) => {
    setExpandedLoops((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(loopIndex)) {
        newSet.delete(loopIndex)
      } else {
        newSet.add(loopIndex)
      }
      return newSet
    })
  }

  const guildAvgByLoop = (() => {
    if (!guildLoopData?.detailedData) return new Map<number, number>()
    const byLoop = new Map<number, { totalDamage: number; hitCount: number }>()
    for (const entry of guildLoopData.detailedData) {
      const existing = byLoop.get(entry.loop) ?? { totalDamage: 0, hitCount: 0 }
      existing.totalDamage += entry.totalDamage
      existing.hitCount += entry.hitCount
      byLoop.set(entry.loop, existing)
    }
    const result = new Map<number, number>()
    byLoop.forEach((data, loopIndex) => {
      result.set(
        loopIndex,
        data.hitCount > 0 ? data.totalDamage / data.hitCount : 0
      )
    })
    return result
  })()

  const loopAggregates = (() => {
    if (!loopData?.detailedData || loopData.detailedData.length === 0) return []

    const byLoop = new Map<number, typeof loopData.detailedData>()
    for (const entry of loopData.detailedData) {
      const existing = byLoop.get(entry.loop) ?? []
      existing.push(entry)
      byLoop.set(entry.loop, existing)
    }

    return Array.from(byLoop.entries())
      .map(([loopIndex, entries]) => {
        const totalDamage = entries.reduce((sum, e) => sum + e.totalDamage, 0)
        const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0)
        const avgDamage = totalHits > 0 ? totalDamage / totalHits : 0
        const maxDamage = Math.max(...entries.map((e) => e.maxDamage))
        const bossCount = entries.length
        const guildAvgDamage = guildAvgByLoop.get(loopIndex) ?? 0
        const startTimes = entries
          .filter((e) => e.startTime)
          .map((e) => new Date(e.startTime!).getTime())
        const endTimes = entries
          .filter((e) => e.endTime)
          .map((e) => new Date(e.endTime!).getTime())
        const durationMinutes =
          startTimes.length > 0 && endTimes.length > 0
            ? (Math.max(...endTimes) - Math.min(...startTimes)) / (1000 * 60)
            : null
        return {
          loopIndex,
          totalDamage,
          avgDamage,
          maxDamage,
          totalHits,
          bossCount,
          durationMinutes,
          guildAvgDamage,
          bosses: entries.sort((a, b) => b.totalDamage - a.totalDamage)
        }
      })
      .sort((a, b) => a.loopIndex - b.loopIndex)
      .map((loop, index, arr) => {
        const prev = arr[index - 1]
        const trend: 'improving' | 'declining' | 'stable' = !prev
          ? 'stable'
          : loop.avgDamage > prev.avgDamage * 1.05
            ? 'improving'
            : loop.avgDamage < prev.avgDamage * 0.95
              ? 'declining'
              : 'stable'
        return { ...loop, trend }
      })
  })()

  // Loop `bossName` is "<Level> <raw token>" ("L5 BelisariusRW"): split off the
  // prefix before resolving or normalizeBossKey's startsWith fails.
  const resolveLoopBossLabel = (fullBossName: string): string => {
    const m = fullBossName.match(/^([ML]\d+)\s+(.+)$/)
    return m
      ? `${m[1]} ${getBossDisplayName(m[2])}`
      : getBossDisplayName(fullBossName)
  }

  const getLoopDetailsForBoss = (bossName: string, level: string) => {
    if (!loopData?.detailedData) return []
    const fullBossName = `${level} ${bossName}`
    return loopData.detailedData
      .filter((d) => d.bossName === fullBossName)
      .sort((a, b) => a.loop - b.loop)
      .map((stat, index, arr) => {
        const prev = arr[index - 1]
        const trend: 'improving' | 'declining' | 'stable' = !prev
          ? 'stable'
          : stat.avgDamage > prev.avgDamage * 1.05
            ? 'improving'
            : stat.avgDamage < prev.avgDamage * 0.95
              ? 'declining'
              : 'stable'
        const durationMinutes =
          stat.startTime && stat.endTime
            ? (new Date(stat.endTime).getTime() -
                new Date(stat.startTime).getTime()) /
              (1000 * 60)
            : null
        return { ...stat, trend, durationMinutes }
      })
  }
  const bossEntries = Object.entries(bossStats || {}).filter(
    ([, stats]) => (stats.encounterId ?? 0) === 0
  )
  const primeEntries = Object.entries(primeStats || {})

  if (bossEntries.length === 0 && primeEntries.length === 0) {
    return (
      <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-4 text-sm text-secondary-wh40k">
        No boss performance data recorded for this player in the selected
        season.
      </div>
    )
  }

  const radarData = [...bossEntries, ...primeEntries]
    .map(([key, stats]) => {
      const label = key.split('_')[0]
      const vsGuildVal =
        stats.vsGuildAvg === VS_GUILD_NA ? 0 : (stats.vsGuildAvg ?? 0)
      const vsClusterVal = stats.vsClusterAvg ?? 0
      const playerVsGuild = Math.min(100, Math.max(0, 50 + vsGuildVal))
      const playerVsCluster = Math.min(100, Math.max(0, 50 + vsClusterVal))
      const level = getBossLevelFromSetAndRarity(
        stats.set || 0,
        stats.rarity || 'Legendary'
      )
      return {
        label,
        displayLabel: level ? `${label} (${level})` : label,
        level,
        player: hasValidCluster ? playerVsCluster : playerVsGuild,
        playerVsGuild,
        playerVsCluster,
        guildBaseline: 50,
        clusterBaseline: 50,
        vsGuild: vsGuildVal,
        vsCluster: vsClusterVal,
        damage: stats.damage ?? 0,
        sortKey: stats.set ?? 999
      }
    })
    .sort((a, b) => a.sortKey - b.sortKey)

  return (
    <div className="space-y-6">
      <BossPerformanceTable
        title="Boss Performance"
        entries={bossEntries}
        expandedBosses={expandedBosses}
        toggleBossExpanded={toggleBossExpanded}
        getLoopDetailsForBoss={getLoopDetailsForBoss}
        hasValidCluster={hasValidCluster}
        guildLabel={guildLabel}
      />
      <BossPerformanceTable
        title="Prime Performance"
        entries={primeEntries}
        expandedBosses={expandedBosses}
        toggleBossExpanded={toggleBossExpanded}
        getLoopDetailsForBoss={getLoopDetailsForBoss}
        hasValidCluster={hasValidCluster}
        guildLabel={guildLabel}
      />
      {/* Loop Analysis Section */}
      {loopAggregates.length > 0 && (
        <LoopAnalysisSection
          loopAggregates={loopAggregates}
          loopAnalysisView={loopAnalysisView}
          setLoopAnalysisView={setLoopAnalysisView}
          selectedLoopBoss={selectedLoopBoss}
          setSelectedLoopBoss={setSelectedLoopBoss}
          expandedLoops={expandedLoops}
          toggleLoopExpanded={toggleLoopExpanded}
          guildLoopData={guildLoopData}
          resolveLoopBossLabel={resolveLoopBossLabel}
        />
      )}

      {radarData.length > 0 && (
        <div className="bg-(--card-bg) border border-(--card-border) rounded-lg chart-card p-4">
          <h3 className="text-lg font-semibold text-primary-wh40k mb-2">
            Boss & Prime Performance Radar
          </h3>
          <p className="text-xs text-secondary-wh40k mb-4">
            Comparing {playerName || 'player'} against guild
            {hasValidCluster ? ' and cluster' : ''} averages across all assigned
            targets.
          </p>
          <ResponsiveContainer width="100%" height={360}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--card-border)" />
              <PolarAngleAxis
                dataKey="displayLabel"
                tick={DEFAULT_AXIS_STYLES.tick}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={<RadiusTick />}
              />
              <Radar
                name={guildLabel}
                dataKey="playerVsGuild"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.25}
                strokeWidth={2}
              />
              {hasValidCluster && (
                <Radar
                  name="vs Cluster Avg"
                  dataKey="playerVsCluster"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.25}
                  strokeWidth={2}
                />
              )}
              <Radar
                name="Baseline (Avg)"
                dataKey="guildBaseline"
                stroke="#f97316"
                fill="#f97316"
                fillOpacity={0.1}
                strokeDasharray="5 5"
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Tooltip
                formatter={asNumericTooltipFormatter((value, name) => {
                  if (name === guildLabel || name === 'vs Cluster Avg') {
                    return [
                      value == null ? '—' : `${Math.round(value - 50)}% vs avg`,
                      name ?? ''
                    ]
                  }
                  if (name === 'Baseline (Avg)') {
                    return ['Baseline (50%)', name ?? '']
                  }
                  return [value ?? '—', name ?? '']
                })}
                contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

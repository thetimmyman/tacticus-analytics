'use client'

import {
  DEFAULT_RECHARTS_TOOLTIP_PROPS,
  asNumericTooltipFormatter
} from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'

import type { Dispatch, SetStateAction } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { formatDamage, formatNumber } from '@tacticus/app-core/formatters'
import {
  ResponsiveContainer,
  Legend,
  Tooltip,
  ComposedChart,
  Line,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis
} from '@/app/components/RechartsWrapper'
import type {
  DamageByBossLoopResult,
  PlayerDamageByBossLoopResult
} from '@/app/lib/data/dashboard-calculations'
import {
  LoopExpandableTable,
  LoopFilterChips,
  LoopMobileGrid,
  sortLoopBossNames
} from '@/app/components/loop-analysis/LoopAnalysisScaffold'
import { formatDuration } from './format-duration'

export interface LoopAggregate {
  loopIndex: number
  totalDamage: number
  avgDamage: number
  maxDamage: number
  totalHits: number
  bossCount: number
  durationMinutes: number | null
  guildAvgDamage: number
  bosses: PlayerDamageByBossLoopResult['detailedData']
  trend: 'improving' | 'declining' | 'stable'
}

interface LoopAnalysisSectionProps {
  loopAggregates: LoopAggregate[]
  loopAnalysisView: 'table' | 'chart'
  setLoopAnalysisView: Dispatch<SetStateAction<'table' | 'chart'>>
  selectedLoopBoss: string | null
  setSelectedLoopBoss: Dispatch<SetStateAction<string | null>>
  expandedLoops: Set<number>
  toggleLoopExpanded: (loopIndex: number) => void
  guildLoopData: DamageByBossLoopResult | undefined
  resolveLoopBossLabel: (fullBossName: string) => string
}

export function LoopAnalysisSection({
  loopAggregates,
  loopAnalysisView,
  setLoopAnalysisView,
  selectedLoopBoss,
  setSelectedLoopBoss,
  expandedLoops,
  toggleLoopExpanded,
  guildLoopData,
  resolveLoopBossLabel
}: LoopAnalysisSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-primary-wh40k">
            Loop Analysis
          </h3>
          <p className="text-xs text-secondary-wh40k">
            {loopAnalysisView === 'table'
              ? 'Overall performance by loop - click to expand and see per-boss breakdown.'
              : 'Damage trends across loops' +
                (selectedLoopBoss
                  ? ` for ${selectedLoopBoss}`
                  : ' (all bosses)')}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-(--card-bg) border border-(--card-border) rounded-lg p-1">
          <button
            type="button"
            onClick={() => setLoopAnalysisView('table')}
            className={`p-1.5 rounded transition-colors ${
              loopAnalysisView === 'table'
                ? 'bg-primary-wh40k text-(--bg-primary)'
                : 'text-secondary-wh40k hover:text-primary-wh40k'
            }`}
            title="Table view"
          >
            <Table2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setLoopAnalysisView('chart')}
            className={`p-1.5 rounded transition-colors ${
              loopAnalysisView === 'chart'
                ? 'bg-primary-wh40k text-(--bg-primary)'
                : 'text-secondary-wh40k hover:text-primary-wh40k'
            }`}
            title="Chart view"
          >
            <BarChart3 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loopAnalysisView === 'chart' ? (
        <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-4">
          <LoopFilterChips
            selectedKey={selectedLoopBoss ?? '__all__'}
            options={[
              { key: '__all__', label: 'All Bosses' },
              ...sortLoopBossNames(
                loopAggregates.flatMap((loop) =>
                  loop.bosses.map((boss) => boss.bossName)
                )
              ).map((bossName) => ({
                key: bossName,
                label: resolveLoopBossLabel(bossName)
              }))
            ]}
            onSelect={(key) =>
              setSelectedLoopBoss(key === '__all__' ? null : key)
            }
          />
          {/* Chart: Tokens (bars), Player avg damage (line), Guild avg damage (line) */}
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={loopAggregates.map((loop) => {
                if (selectedLoopBoss) {
                  const boss = loop.bosses.find(
                    (b) => b.bossName === selectedLoopBoss
                  )
                  const guildBossData =
                    guildLoopData?.detailedData?.filter(
                      (d) =>
                        d.loop === loop.loopIndex &&
                        d.bossName === selectedLoopBoss
                    ) ?? []
                  const guildBossTotalDmg = guildBossData.reduce(
                    (sum, d) => sum + d.totalDamage,
                    0
                  )
                  const guildBossHits = guildBossData.reduce(
                    (sum, d) => sum + d.hitCount,
                    0
                  )
                  const guildBossAvg =
                    guildBossHits > 0 ? guildBossTotalDmg / guildBossHits : 0
                  return {
                    loop: `Loop ${loop.loopIndex + 1}`,
                    tokens: boss?.hitCount ?? 0,
                    playerAvg: boss?.avgDamage ?? 0,
                    guildAvg: guildBossAvg
                  }
                }
                return {
                  loop: `Loop ${loop.loopIndex + 1}`,
                  tokens: loop.totalHits,
                  playerAvg: loop.avgDamage,
                  guildAvg: loop.guildAvgDamage
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
                tickFormatter={(value: number) => formatDamage(value)}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={DEFAULT_AXIS_STYLES.tick}
              />
              <Tooltip
                contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                formatter={asNumericTooltipFormatter((value, name) => [
                  value == null
                    ? '—'
                    : name === 'tokens'
                      ? formatNumber(value, 0)
                      : formatDamage(value),
                  name === 'tokens'
                    ? 'Tokens Used'
                    : name === 'playerAvg'
                      ? 'Your Avg Damage'
                      : 'Guild Avg Damage'
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
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="playerAvg"
                name="Your Avg Damage"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ fill: '#3b82f6' }}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="guildAvg"
                name="Guild Avg Damage"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: '#10b981' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <>
          <LoopExpandableTable
            headers={[
              'Total Damage',
              'Avg Hit',
              'Max Hit',
              'Hits',
              'Bosses',
              'Duration'
            ]}
            expanded={expandedLoops}
            onToggle={toggleLoopExpanded}
            rows={loopAggregates.map((loop) => ({
              key: loop.loopIndex,
              loopLabel: `Loop ${loop.loopIndex + 1}`,
              trend: loop.trend,
              cells: [
                {
                  content: formatNumber(loop.totalDamage),
                  className: 'font-mono text-yellow-400'
                },
                {
                  content: formatNumber(loop.avgDamage),
                  className: 'font-mono text-blue-400'
                },
                {
                  content: formatNumber(loop.maxDamage),
                  className: 'font-mono'
                },
                { content: loop.totalHits },
                { content: loop.bossCount },
                {
                  content: loop.durationMinutes
                    ? formatDuration(loop.durationMinutes * 60)
                    : '-',
                  className: 'text-secondary-wh40k'
                }
              ],
              detailHeaders: [
                'Boss',
                'Total Dmg',
                'Avg Hit',
                'Max Hit',
                'Hits'
              ],
              detailRows: loop.bosses.map((boss) => ({
                key: `loop-${loop.loopIndex}-boss-${boss.bossName}`,
                cells: [
                  { content: resolveLoopBossLabel(boss.bossName) },
                  {
                    content: formatNumber(boss.totalDamage),
                    className: 'font-mono text-yellow-400'
                  },
                  {
                    content: formatNumber(boss.avgDamage),
                    className: 'font-mono text-blue-400'
                  },
                  {
                    content: formatNumber(boss.maxDamage),
                    className: 'font-mono'
                  },
                  { content: boss.hitCount }
                ]
              }))
            }))}
          />
          <LoopMobileGrid
            cards={loopAggregates.map((loop) => ({
              key: loop.loopIndex,
              title: `Loop ${loop.loopIndex + 1}`,
              trend: loop.trend,
              metrics: [
                {
                  label: 'Total Damage',
                  value: formatNumber(loop.totalDamage),
                  className: 'font-mono text-yellow-400'
                },
                {
                  label: 'Avg Hit',
                  value: formatNumber(loop.avgDamage),
                  className: 'font-mono text-blue-400'
                },
                {
                  label: 'Max Hit',
                  value: formatNumber(loop.maxDamage),
                  className: 'font-mono text-primary-wh40k'
                },
                {
                  label: 'Hits',
                  value: loop.totalHits,
                  className: 'text-primary-wh40k'
                }
              ],
              footer: (
                <>
                  {loop.bossCount} bosses •{' '}
                  {loop.durationMinutes
                    ? formatDuration(loop.durationMinutes * 60)
                    : '-'}
                </>
              )
            }))}
          />
        </>
      )}
    </div>
  )
}

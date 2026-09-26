'use client'

import React from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  TrendingUp as TrendingUpAlt
} from 'lucide-react'
import { formatDamage, formatNumber } from '@tacticus/app-core/formatters'
import { type TrendDirection } from './boss-performance-tooltips'
import { getTrendIcon } from './boss-performance-trend-visuals'

export type LoopMetric = {
  loopIndex: number
  problemCount: number
  performingWellCount: number
  avgTokensPerBoss: number
  avgDamagePerHit: number
  problemBossesList: Array<{
    name: string
    damage: number
    efficiency: number
  }>
  performingWellList: Array<{
    name: string
    damage: number
    efficiency: number
  }>
  trends: Record<string, TrendDirection>
}

export function BossPerformanceLoopTable({
  loopMetrics,
  expandedLoopIndex,
  setExpandedLoopIndex
}: {
  loopMetrics: LoopMetric[]
  expandedLoopIndex: number | null
  setExpandedLoopIndex: Dispatch<SetStateAction<number | null>>
}) {
  return (
    <div className="mb-4 overflow-x-auto animate-in fade-in slide-in-from-top-2 duration-300">
      <table className="w-full text-sm text-left border-collapse">
        <thead className="text-xs text-[var(--text-secondary)] uppercase bg-card/50">
          <tr>
            <th className="px-3 py-2 rounded-tl-lg">Loop</th>
            <th className="px-3 py-2 text-center">Problems</th>
            <th className="px-3 py-2 text-center">Perf. Well</th>
            <th className="px-3 py-2 text-right">Avg Tokens</th>
            <th className="px-3 py-2 text-right rounded-tr-lg">Avg Dmg/Hit</th>
          </tr>
        </thead>
        <tbody>
          {loopMetrics.map((loop) => (
            <React.Fragment key={`loop-metric-${loop.loopIndex}`}>
              <tr
                className="border-b border-card-border/30 hover:bg-[var(--card-hover)] transition-colors cursor-pointer group/row"
                onClick={() =>
                  setExpandedLoopIndex(
                    expandedLoopIndex === loop.loopIndex ? null : loop.loopIndex
                  )
                }
              >
                <td className="px-3 py-2 font-medium text-[var(--text-primary)] flex items-center gap-2">
                  {expandedLoopIndex === loop.loopIndex ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-[var(--text-secondary)] group-hover/row:text-[var(--text-primary)]" />
                  )}
                  Loop {loop.loopIndex + 1}
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span
                      className={
                        loop.problemCount > 0
                          ? 'text-red-400 font-bold'
                          : 'text-[var(--text-secondary)]'
                      }
                    >
                      {loop.problemCount}
                    </span>
                    {getTrendIcon(loop.trends.problemCount ?? 'stable')}
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-green-400 font-bold">
                      {loop.performingWellCount}
                    </span>
                    {getTrendIcon(loop.trends.performingWellCount ?? 'stable')}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-yellow-400 font-mono">
                      {formatNumber(loop.avgTokensPerBoss, 1)}
                    </span>
                    {getTrendIcon(loop.trends.avgTokensPerBoss ?? 'stable')}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-blue-400 font-mono">
                      {formatDamage(loop.avgDamagePerHit)}
                    </span>
                    {getTrendIcon(loop.trends.avgDamagePerHit ?? 'stable')}
                  </div>
                </td>
              </tr>
              {expandedLoopIndex === loop.loopIndex && (
                <tr className="bg-card/20">
                  <td
                    colSpan={5}
                    className="p-3 border-b border-card-border/30"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Problems List */}
                      <div>
                        <h4 className="text-xs font-semibold text-red-400 mb-2 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Problem Bosses
                        </h4>
                        {loop.problemBossesList.length > 0 ? (
                          <ul className="space-y-1">
                            {loop.problemBossesList.map((boss) => (
                              <li
                                key={boss.name}
                                className="flex justify-between text-xs text-[var(--text-secondary)]"
                              >
                                <span>{boss.name}</span>
                                <span className="text-red-400 font-mono">
                                  {Math.round(boss.efficiency)}%
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-[var(--text-secondary)] italic">
                            None
                          </div>
                        )}
                      </div>

                      {/* Performing Well List */}
                      <div>
                        <h4 className="text-xs font-semibold text-green-400 mb-2 flex items-center gap-1">
                          <TrendingUpAlt className="h-3 w-3" /> Performing Well
                        </h4>
                        {loop.performingWellList.length > 0 ? (
                          <ul className="space-y-1">
                            {loop.performingWellList.map((boss) => (
                              <li
                                key={boss.name}
                                className="flex justify-between text-xs text-[var(--text-secondary)]"
                              >
                                <span>{boss.name}</span>
                                <span className="text-green-400 font-mono">
                                  {Math.round(boss.efficiency)}%
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-[var(--text-secondary)] italic">
                            None
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

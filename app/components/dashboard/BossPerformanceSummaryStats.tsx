'use client'

import type { Dispatch, SetStateAction } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { formatDamage, formatNumber } from '@tacticus/app-core/formatters'
import { Tooltip } from './BossPerformanceTrendsTooltip'
import { summaryTooltips } from './boss-performance-tooltips'

export function BossPerformanceSummaryStats({
  problemBosses,
  improvingBosses,
  averageTokensPerBoss,
  averageDamagePerHitAcross,
  averageEfficiencyPct,
  isLoopTableOpen,
  setIsLoopTableOpen
}: {
  problemBosses: number
  improvingBosses: number
  averageTokensPerBoss: number
  averageDamagePerHitAcross: number
  averageEfficiencyPct: number
  isLoopTableOpen: boolean
  setIsLoopTableOpen: Dispatch<SetStateAction<boolean>>
}) {
  return (
    <div
      className="relative group cursor-pointer mb-4"
      onClick={() => setIsLoopTableOpen(!isLoopTableOpen)}
      title="Click to toggle detailed loop analysis"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-card/30 rounded-lg group-hover:bg-card/50 transition-colors">
        <Tooltip content={summaryTooltips.problemBosses(problemBosses)}>
          <div className="text-center cursor-help">
            <div className="text-red-400 font-bold text-lg">
              {problemBosses}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Problem Bosses
            </div>
          </div>
        </Tooltip>
        <Tooltip content={summaryTooltips.performingWell(improvingBosses)}>
          <div className="text-center cursor-help">
            <div className="text-green-400 font-bold text-lg">
              {improvingBosses}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Performing Well
            </div>
          </div>
        </Tooltip>
        <Tooltip content={summaryTooltips.averageTokens(averageTokensPerBoss)}>
          <div className="text-center cursor-help">
            <div className="text-yellow-400 font-bold text-lg">
              {formatNumber(averageTokensPerBoss, 0)}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Avg Tokens/Boss
            </div>
          </div>
        </Tooltip>
        <Tooltip
          content={summaryTooltips.damageEfficiency(
            averageDamagePerHitAcross,
            averageEfficiencyPct
          )}
        >
          <div className="text-center cursor-help">
            <div className="text-blue-400 font-bold text-lg">
              {formatDamage(averageDamagePerHitAcross)}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Avg Dmg/Hit
            </div>
          </div>
        </Tooltip>

        {/* Expansion Indicator */}
        <div className="absolute top-2 right-2 text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity">
          {isLoopTableOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </div>
    </div>
  )
}

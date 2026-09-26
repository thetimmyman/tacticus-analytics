'use client'

import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import {
  ProgressBar,
  StackedProgressBar
} from '@/app/components/visualizations/ProgressBar'
import {
  getRarityPrefix,
  normalizeRarity
} from '@tacticus/app-core/rarity-utils'
import { MechanicusEmptyState as EmptyState } from '@tacticus/ui-kit/loading'
import type { BossPerformanceMetric } from '@/app/lib/hooks/queries'
import type {
  BossPerformanceSummary,
  LoopTokenEntry,
  PrimePerformanceSummary
} from '@/app/components/dashboard-summary/types'

interface PerformanceColumnsProps {
  loadPieChart: boolean
  bossPerformanceData: BossPerformanceMetric[] | undefined
  bossPerformance: BossPerformanceSummary[]
  primePerformance: PrimePerformanceSummary[]
  hasCluster: boolean
  loopTokenData: LoopTokenEntry[]
}

export function PerformanceColumns({
  loadPieChart,
  bossPerformanceData,
  bossPerformance,
  primePerformance,
  hasCluster,
  loopTokenData
}: PerformanceColumnsProps) {
  return (
    <>
      {/* Three Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Boss Performance */}
        <div className="card-wh40k chart-card p-3 sm:p-4 hover:shadow-xl hover:shadow-[color:color-mix(in_srgb,var(--primary)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] transition-all duration-300">
          <h3 className="subheading-wh40k">AVG vs MAX Damage to Bosses</h3>
          <div className="space-y-3">
            {!loadPieChart || !bossPerformanceData ? (
              <div className="space-y-3">
                {[
                  'boss-skel-1',
                  'boss-skel-2',
                  'boss-skel-3',
                  'boss-skel-4',
                  'boss-skel-5'
                ].map((id) => (
                  <div key={id} className="animate-pulse">
                    <div className="h-4 bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded mb-2"></div>
                    <div className="h-6 bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded"></div>
                  </div>
                ))}
              </div>
            ) : bossPerformance.length > 0 ? (
              bossPerformance.map((boss) => (
                <ProgressBar
                  key={`boss-${boss.tier}-${boss.boss}`}
                  label={`${normalizeRarity(boss.rarity) ? getRarityPrefix(normalizeRarity(boss.rarity)!) : 'L'}${boss.tier} ${getBossDisplayName(boss.boss)}`}
                  avgValue={boss.avgDamage}
                  maxValue={boss.maxDamage}
                  vsClusterPercent={
                    hasCluster ? boss.vsClusterPercent : undefined
                  }
                  color="blue"
                />
              ))
            ) : (
              <EmptyState
                title="No Boss data Available"
                description="No boss data are currently available"
              />
            )}
          </div>
        </div>

        {/* Prime Performance */}
        <div className="card-wh40k p-3 sm:p-4 hover:shadow-xl hover:shadow-[color:color-mix(in_srgb,var(--primary)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] transition-all duration-300">
          <h3 className="subheading-wh40k text-green-400">
            AVG vs MAX Damage to Primes
          </h3>
          <div className="space-y-3 max-h-64 sm:max-h-96 overflow-y-auto">
            {!loadPieChart || !bossPerformanceData ? (
              <div className="space-y-3">
                {[
                  'prime-skel-1',
                  'prime-skel-2',
                  'prime-skel-3',
                  'prime-skel-4'
                ].map((id) => (
                  <div key={id} className="animate-pulse">
                    <div className="h-4 bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded mb-2"></div>
                    <div className="h-6 bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded"></div>
                  </div>
                ))}
              </div>
            ) : primePerformance.length > 0 ? (
              primePerformance.map((prime) => (
                <ProgressBar
                  key={prime.prime}
                  label={`${normalizeRarity(prime.rarity) ? getRarityPrefix(normalizeRarity(prime.rarity)!) : 'L'}${prime.level} ${prime.prime}`}
                  avgValue={prime.avgDamage}
                  maxValue={prime.maxDamage}
                  vsClusterPercent={
                    hasCluster ? prime.vsClusterPercent : undefined
                  }
                  color="green"
                />
              ))
            ) : (
              <EmptyState
                title="No Prime data Available"
                description="No prime data are currently available"
              />
            )}
          </div>
        </div>

        {/* Tokens Per Lap */}
        <div className="card-wh40k p-3 sm:p-4 hover:shadow-xl hover:shadow-[color:color-mix(in_srgb,var(--primary)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] transition-all duration-300">
          <h3 className="subheading-wh40k text-yellow-400">Tokens Per Lap</h3>
          <div className="mb-3 sm:mb-4 p-2 sm:p-3 bg-slate-800/50 rounded-lg border border-[var(--card-border)]">
            <div className="text-center text-xs sm:text-sm flex items-center justify-center gap-2 sm:gap-3">
              <span className="text-[var(--accent)] font-semibold">
                Bosses:{' '}
                {loopTokenData.reduce((sum, l) => sum + l.bossTokens, 0)}
              </span>
              <span className="text-[var(--text-secondary)]">•</span>
              <span className="text-[var(--accent)] font-semibold">
                Primes:{' '}
                {loopTokenData.reduce((sum, l) => sum + l.primeTokens, 0)}
              </span>
              <span className="text-[var(--text-secondary)]">•</span>
              <span className="text-yellow-400 font-semibold">
                Total:{' '}
                {loopTokenData.reduce((sum, l) => sum + l.totalTokens, 0)}
              </span>
            </div>
          </div>
          <div className="max-h-64 sm:max-h-96 overflow-y-auto space-y-2 sm:space-y-3 pr-2">
            {(() => {
              const maxTokens = Math.max(
                ...loopTokenData.map((l) => l.totalTokens),
                1
              )

              return [...loopTokenData]
                .sort((a, b) => b.actualLoop - a.actualLoop)
                .map((loop) => (
                  <StackedProgressBar
                    key={loop.actualLoop}
                    label={`Loop ${loop.loop}`}
                    segments={[
                      {
                        label: 'Bosses',
                        value: loop.bossTokens,
                        color: 'blue'
                      },
                      {
                        label: 'Primes',
                        value: loop.primeTokens,
                        color: 'pink'
                      }
                    ]}
                    total={maxTokens}
                    showLabels={false}
                  />
                ))
            })()}
          </div>
        </div>
      </div>
    </>
  )
}

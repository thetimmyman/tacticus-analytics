'use client'

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { ArrowRightLeft, Sparkles } from 'lucide-react'
import {
  compactSummaryMetric,
  deltaClass,
  parseBoundedIntInput,
  strategyDeltaMetric
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-format'
import type {
  RosterStrategyInvestment,
  RosterStrategyMember,
  RosterStrategyPayload
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'
import RosterOptimizerCard from '@/app/(dashboard)/boss-assignments/season-planner/RosterOptimizerCard'
import InvestmentPrioritiesCard from '@/app/(dashboard)/boss-assignments/season-planner/InvestmentPrioritiesCard'

interface RosterStrategySectionProps {
  strategySeasonCount: number
  setStrategySeasonCount: Dispatch<SetStateAction<number>>
  strategyRequestIdRef: MutableRefObject<number>
  setStrategy: Dispatch<SetStateAction<RosterStrategyPayload | null>>
  setStrategyError: Dispatch<SetStateAction<string | null>>
  setStrategyLoading: Dispatch<SetStateAction<boolean>>
  setSwapOutgoingPlayerId: Dispatch<SetStateAction<string>>
  setSwapIncomingPlayerId: Dispatch<SetStateAction<string>>
  setSwapIncomingGuildFilter: Dispatch<SetStateAction<string>>
  runRosterStrategy: (options: { includeOptimizer: boolean }) => Promise<void>
  strategyLoading: boolean
  snapshotLoading: boolean
  displayedPlanSnapshotAt: string | null
  swapSimulationUnavailable: boolean
  loadingSavedPlanId: string | null
  strategyOptimizerRequested: boolean
  strategy: RosterStrategyPayload | null
  strategyError: string | null
  guildLabel: (guildCode: string) => string
  labelFor: (displayName: string | null | undefined) => string
  strategyTargetMembers: RosterStrategyMember[]
  strategyAllIncomingMembers: RosterStrategyMember[]
  strategyIncomingGuildOptions: Array<{
    guildCode: string
    optionLabel: string
  }>
  strategyIncomingMembers: RosterStrategyMember[]
  swapOutgoingPlayerId: string
  swapIncomingPlayerId: string
  swapIncomingGuildFilter: string
  clearSwapResult: () => void
  investmentRows: RosterStrategyInvestment[]
}

export default function RosterStrategySection({
  strategySeasonCount,
  setStrategySeasonCount,
  strategyRequestIdRef,
  setStrategy,
  setStrategyError,
  setStrategyLoading,
  setSwapOutgoingPlayerId,
  setSwapIncomingPlayerId,
  setSwapIncomingGuildFilter,
  runRosterStrategy,
  strategyLoading,
  snapshotLoading,
  displayedPlanSnapshotAt,
  swapSimulationUnavailable,
  loadingSavedPlanId,
  strategyOptimizerRequested,
  strategy,
  strategyError,
  guildLabel,
  labelFor,
  strategyTargetMembers,
  strategyAllIncomingMembers,
  strategyIncomingGuildOptions,
  strategyIncomingMembers,
  swapOutgoingPlayerId,
  swapIncomingPlayerId,
  swapIncomingGuildFilter,
  clearSwapResult,
  investmentRows
}: RosterStrategySectionProps) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            Roster Strategy Planner
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Swap simulation, cluster optimization, and hero investment
            priorities for the selected boss rotation.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">
              Seasons
            </span>
            <select
              value={strategySeasonCount}
              onChange={(e) => {
                strategyRequestIdRef.current += 1
                setStrategy(null)
                setStrategyError(null)
                setStrategyLoading(false)
                setSwapOutgoingPlayerId('')
                setSwapIncomingPlayerId('')
                setSwapIncomingGuildFilter('all')
                setStrategySeasonCount(
                  parseBoundedIntInput(e.target.value, 1, 1, 5)
                )
              }}
              className="w-28 rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value={1}>Current</option>
              <option value={2}>Current +1</option>
              <option value={3}>Current +2</option>
              <option value={4}>Current +3</option>
              <option value={5}>Current +4</option>
            </select>
          </label>
          <button
            onClick={() => void runRosterStrategy({ includeOptimizer: false })}
            disabled={
              strategyLoading ||
              snapshotLoading ||
              !displayedPlanSnapshotAt ||
              swapSimulationUnavailable ||
              loadingSavedPlanId !== null
            }
            className="inline-flex items-center gap-2 rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-card/80 disabled:opacity-50"
          >
            <ArrowRightLeft className="h-4 w-4" />
            {strategyLoading && !strategyOptimizerRequested
              ? 'Simulating...'
              : strategy
                ? 'Simulate Swap'
                : 'Load Roster'}
          </button>
          <button
            onClick={() => void runRosterStrategy({ includeOptimizer: true })}
            disabled={
              strategyLoading ||
              snapshotLoading ||
              !displayedPlanSnapshotAt ||
              loadingSavedPlanId !== null
            }
            className="inline-flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] px-4 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--primary)_30%,transparent)] disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {strategyLoading && strategyOptimizerRequested
              ? 'Optimizing...'
              : 'Optimize Roster'}
          </button>
        </div>
      </div>

      {strategyError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {strategyError}
        </div>
      )}

      {!strategy && !strategyLoading && (
        <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4 text-sm text-[var(--text-secondary)]">
          Load the roster to review same-cluster members and strategy output.
        </div>
      )}

      {strategy && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                  Baseline projection
                </h4>
                <p className="text-xs text-[var(--text-secondary)]">
                  {guildLabel(strategy.targetGuildCode)}
                  {strategy.clusterCode ? ` · ${strategy.clusterCode}` : ''}
                  {' · '}
                  {strategy.seasons.map((s) => `S${s.season}`).join(', ')}
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                {compactSummaryMetric(strategy.baseline.aggregate).map(
                  (metric) => (
                    <div key={metric.label}>
                      <div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                        {metric.label}
                      </div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {metric.value}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
            {strategy.warnings.length > 0 && (
              <div className="mt-3 text-xs text-amber-200">
                {strategy.warnings.join(' · ')}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-[var(--accent)]" />
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                Cluster swap simulator
              </h4>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  Current guild member
                </span>
                <select
                  value={swapOutgoingPlayerId}
                  onChange={(e) => {
                    setSwapOutgoingPlayerId(e.target.value)
                    clearSwapResult()
                  }}
                  disabled={strategyTargetMembers.length === 0}
                  className="w-full rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  {strategyTargetMembers.length === 0 && (
                    <option value="">No current guild members</option>
                  )}
                  {strategyTargetMembers.map((member) => (
                    <option key={member.playerId} value={member.playerId}>
                      {labelFor(member.displayName)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  Incoming guild
                </span>
                <select
                  value={swapIncomingGuildFilter}
                  onChange={(e) => {
                    setSwapIncomingGuildFilter(e.target.value)
                    setSwapIncomingPlayerId('')
                    clearSwapResult()
                  }}
                  disabled={strategyIncomingGuildOptions.length === 0}
                  className="w-full rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  <option value="all">
                    All cluster guilds · {strategyAllIncomingMembers.length}{' '}
                    members
                  </option>
                  {strategyIncomingGuildOptions.map((option) => (
                    <option key={option.guildCode} value={option.guildCode}>
                      {option.optionLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  Incoming cluster member
                </span>
                <select
                  value={swapIncomingPlayerId}
                  onChange={(e) => {
                    setSwapIncomingPlayerId(e.target.value)
                    clearSwapResult()
                  }}
                  disabled={strategyIncomingMembers.length === 0}
                  className="w-full rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  {strategyIncomingMembers.length === 0 && (
                    <option value="">No incoming cluster members</option>
                  )}
                  {strategyIncomingMembers.map((member) => (
                    <option key={member.playerId} value={member.playerId}>
                      {labelFor(member.displayName)} ·{' '}
                      {guildLabel(member.guildCode)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {strategy.swap ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {[
                  {
                    title: guildLabel(strategy.swap.targetGuildAfter.guildCode),
                    delta: strategy.swap.targetGuildDelta
                  },
                  {
                    title: guildLabel(
                      strategy.swap.partnerGuildAfter.guildCode
                    ),
                    delta: strategy.swap.partnerGuildDelta
                  },
                  {
                    title: 'Combined',
                    delta: strategy.swap.combinedDelta
                  }
                ].map((row) => (
                  <div
                    key={row.title}
                    className="rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] p-3"
                  >
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {row.title}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {strategyDeltaMetric(row.delta).map((metric) => (
                        <div key={metric.label}>
                          <div className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                            {metric.label}
                          </div>
                          <div
                            className={`text-sm font-semibold ${deltaClass(
                              metric.label === 'Score'
                                ? row.delta.score
                                : metric.label === 'Damage/token'
                                  ? row.delta.tokenEfficiency
                                  : metric.label === 'Clears'
                                    ? row.delta.bossesDefeated
                                    : row.delta.loopAdvances
                            )}`}
                          >
                            {metric.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-[var(--text-secondary)]">
                {strategyTargetMembers.length === 0
                  ? 'No current guild members are available to swap.'
                  : strategyIncomingMembers.length === 0
                    ? 'No incoming same-cluster members are available to simulate.'
                    : 'Select two members and simulate the swap.'}
              </div>
            )}
          </div>

          <RosterOptimizerCard
            optimizer={strategy.optimizer}
            strategyOptimizerRequested={strategyOptimizerRequested}
            guildLabel={guildLabel}
          />

          <InvestmentPrioritiesCard
            investments={strategy.investments}
            investmentRows={investmentRows}
            labelFor={labelFor}
          />
        </div>
      )}
    </div>
  )
}

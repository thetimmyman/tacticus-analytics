'use client'

import { useMemo, useState } from 'react'
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Users
} from 'lucide-react'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { EmptyState } from '@tacticus/ui-kit'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'
import { bossNamesMatch } from '@/app/lib/utils/normalize'
import { AssignedAttackersTable } from './AssignedAttackersTable'
import type { CurrentBossAssignmentRow } from './CurrentBossAssignmentsPanel'
import type {
  SolverResponse,
  StageAssignmentEntry,
  PlayerBudgetEntry,
  QueueStageEntry,
  TokenPerformanceData,
  PerformanceData
} from '../types'
import {
  lookupAvgDamageForStage,
  resolveSlotBossNameForStage
} from './queue-helpers'

interface QueueViewPanelProps {
  data: SolverResponse | null
  loading: boolean
  error: string | null
  isStale: boolean
  onRefresh: () => void
  avatarMap?: Map<string, string | null>
  guildCode?: string
  hideCurrentStageCard?: boolean
  // displayName → bossKey ("Magnus_L4") history, hydrating future-stage Avg dmg.
  tokenPerformance?: TokenPerformanceData
  // Avg-dmg fallback for players tokenPerformance lacks.
  performanceData?: PerformanceData
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  hard: 'bg-red-500/20 text-red-400 border-red-500/30'
}

function StageBadge({
  stage,
  isActive,
  onClick
}: {
  stage: QueueStageEntry
  isActive: boolean
  onClick: () => void
}) {
  const diffClass =
    DIFFICULTY_COLORS[stage.difficulty] ??
    'bg-gray-500/20 text-gray-400 border-gray-500/30'
  return (
    <button
      onClick={onClick}
      className={`flex min-w-44 shrink-0 items-center gap-3 rounded-lg border px-4 py-3 text-xs font-medium transition-all ${diffClass} ${
        stage.isCurrentStage ? 'ring-2 ring-amber-400/60' : ''
      } ${isActive ? 'shadow-lg brightness-110' : 'opacity-60 hover:opacity-90'}`}
    >
      <BossPortrait bossName={stage.mainBoss} size="small" variant="icon" />
      <div className="text-left">
        <div className="flex items-center gap-1.5">
          <span className="font-bold">{stage.stageCode}</span>
          {stage.isCurrentStage && (
            <span className="rounded-sm bg-amber-500/30 px-1 py-px text-[9px] font-semibold leading-tight text-amber-300">
              NOW
            </span>
          )}
        </div>
        <div className="mt-0.5 whitespace-nowrap text-[11px] leading-tight opacity-80">
          {getBossDisplayName(stage.mainBoss)}
        </div>
      </div>
    </button>
  )
}

function resolveTargetNameForStage(
  stage: QueueStageEntry,
  bossId: string
): string {
  const slot = resolveSlotBossNameForStage(stage, bossId)
  return getBossDisplayName(slot ?? bossId)
}
// Keys like `getGuildTokenPerformance` (`${bossName}_${stageCode}`), fuzzy `bossNamesMatch` fallback.
function lookupTokenEntryForStage(
  stage: QueueStageEntry,
  tokenPerformance: TokenPerformanceData,
  displayName: string,
  bossId: string
) {
  const slotBoss = resolveSlotBossNameForStage(stage, bossId)
  if (!slotBoss) return null
  const bucket = tokenPerformance[displayName]
  if (!bucket) return null
  const stageKey = `${slotBoss}_${stage.stageCode}`
  const exact = bucket[stageKey]
  if (exact) return exact
  const matchKey = Object.keys(bucket).find((k) => bossNamesMatch(k, stageKey))
  return matchKey ? (bucket[matchKey] ?? null) : null
}

function StageDetailCard({
  stage,
  assignments,
  playerBudgets,
  defaultOpen,
  avatarMap,
  guildCode,
  tokenPerformance,
  performanceData
}: {
  stage: QueueStageEntry
  assignments: StageAssignmentEntry | undefined
  playerBudgets: Record<string, PlayerBudgetEntry>
  defaultOpen: boolean
  avatarMap: Map<string, string | null>
  guildCode: string
  tokenPerformance: TokenPerformanceData
  performanceData: PerformanceData
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const diffClass = DIFFICULTY_COLORS[stage.difficulty] ?? ''

  // Reuses the 13-column table; unknown fields stay null/0 and render '-'.
  const assignmentRows: CurrentBossAssignmentRow[] = useMemo(() => {
    if (!assignments?.assignments) return []
    const solverScoreByKey = new Map<string, number>()
    assignments.assignments.forEach((a) => {
      solverScoreByKey.set(
        `${a.playerId}:${a.bossId}`,
        Number.isFinite(a.score) ? a.score : 0
      )
    })

    // Stage-level projected HP per encounter, shown on every row (not a running decrement).
    const projectedHpByBossId = new Map<string, number>()
    if (assignments.projections) {
      const mainId = `${stage.stageCode}_main`
      projectedHpByBossId.set(
        mainId,
        assignments.projections.main.projectedRemainingHp
      )
      if (assignments.projections.prime1) {
        projectedHpByBossId.set(
          `${stage.stageCode}_prime1`,
          assignments.projections.prime1.projectedRemainingHp
        )
      }
      if (assignments.projections.prime2) {
        projectedHpByBossId.set(
          `${stage.stageCode}_prime2`,
          assignments.projections.prime2.projectedRemainingHp
        )
      }
    }

    return (
      assignments.assignments
        .filter((a) => a.tokens > 0)
        .map<CurrentBossAssignmentRow>((a) => {
          const budget = playerBudgets[a.playerId]
          const displayName = budget?.displayName ?? a.playerId

          // No expectedDamagePerAttack/tokenEquivalent: they are guild-pooled, not per-player.
          const entry = lookupTokenEntryForStage(
            stage,
            tokenPerformance,
            displayName,
            a.bossId
          )
          let avgDamage: number | null = null
          if (entry && entry.tokensSpent > 0 && entry.actualDamage > 0) {
            const avg = entry.actualDamage / entry.tokensSpent
            if (Number.isFinite(avg) && avg > 0) avgDamage = avg
          }
          // tokenPerformance is sparse; performanceData has better coverage.
          if (avgDamage === null) {
            avgDamage = lookupAvgDamageForStage(
              stage,
              performanceData,
              displayName,
              a.playerId,
              a.bossId
            )
          }

          return {
            playerId: a.playerId,
            displayName,
            tokensAvailable: null,
            timeToNextToken: null,
            target: resolveTargetNameForStage(stage, a.bossId),
            targetId: a.bossId,
            targetRemainingHp: null,
            planned: a.tokens,
            used: 0,
            remaining: a.tokens,
            avgDamage,
            actualDamage: 0,
            estHpRemaining: projectedHpByBossId.get(a.bossId) ?? null,
            unplanned: false
          }
        })
        // Tokens planned desc, then solver score.
        .sort((a, b) => {
          const byPlanned = b.planned - a.planned
          if (byPlanned !== 0) return byPlanned
          const scoreA =
            solverScoreByKey.get(`${a.playerId}:${a.targetId}`) ?? 0
          const scoreB =
            solverScoreByKey.get(`${b.playerId}:${b.targetId}`) ?? 0
          return scoreB - scoreA
        })
    )
  }, [assignments, playerBudgets, stage, tokenPerformance, performanceData])

  if (assignmentRows.length === 0) return null

  const assignedTokens =
    assignments?.coverage?.assigned ??
    assignmentRows.reduce((s, r) => s + r.planned, 0)

  return (
    <div
      className={`rounded-lg border border-(--card-border) bg-card/40 p-4 ${stage.isCurrentStage ? 'ring-1 ring-amber-400/30' : ''}`}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-secondary-wh40k">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <BossPortrait bossName={stage.mainBoss} size="small" variant="icon" />
          <div>
            <div className="text-sm font-semibold text-primary-wh40k">
              <span
                className={`mr-2 inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-bold ${diffClass}`}
              >
                {stage.stageCode}
              </span>
              {getBossDisplayName(stage.mainBoss)}
              {stage.isCurrentStage ? (
                // Top panel = actuals (who attacked); this card = pending plan (who is next).
                <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                  Pending · Current stage
                </span>
              ) : (
                <span className="ml-2 rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-secondary-wh40k">
                  Upcoming
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-secondary-wh40k">
              Loop {stage.loopIndex} · {assignedTokens} tokens planned ·{' '}
              {assignmentRows.length} players
              {stage.isCurrentStage && ' · these players have NOT attacked yet'}
            </div>
            {/* Binding officer-target cap: the plan stops at budgeted tokens though the model expects more. */}
            {assignments?.targetCaps && assignments.targetCaps.length > 0 && (
              <div className="mt-1 space-y-0.5 text-[11px] text-amber-400">
                {assignments.targetCaps.map((cap) => (
                  <div key={cap.bossId}>
                    {resolveTargetNameForStage(stage, cap.bossId)}: officer
                    target of {cap.capTokens} tokens reached · model expects +
                    {cap.shortfallTokens} more
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="mt-3">
          <AssignedAttackersTable
            rows={assignmentRows}
            avatarMap={avatarMap}
            guildCode={guildCode}
          />
        </div>
      )}
    </div>
  )
}

export function QueueViewPanel({
  data,
  loading,
  error,
  isStale,
  onRefresh,
  avatarMap,
  guildCode,
  hideCurrentStageCard = false,
  tokenPerformance,
  performanceData
}: QueueViewPanelProps) {
  const [activeStageIndex, setActiveStageIndex] = useState(0)

  const resolvedAvatarMap = useMemo(
    () => avatarMap ?? new Map<string, string | null>(),
    [avatarMap]
  )
  const resolvedGuildCode = guildCode ?? ''
  const resolvedTokenPerformance = useMemo(
    () => tokenPerformance ?? {},
    [tokenPerformance]
  )
  const resolvedPerformanceData = useMemo(
    () => performanceData ?? {},
    [performanceData]
  )

  const sequence = useMemo(() => data?.sequence ?? [], [data?.sequence])
  const stageAssignments = useMemo(
    () => data?.stage_assignments ?? [],
    [data?.stage_assignments]
  )
  const playerBudgets = useMemo(
    () => data?.player_budgets ?? {},
    [data?.player_budgets]
  )
  const metrics = data?.metrics
  const visibleStages = useMemo(
    () =>
      hideCurrentStageCard
        ? sequence.filter((stage) => !stage.isCurrentStage)
        : sequence,
    [hideCurrentStageCard, sequence]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-(--card-border) bg-card/40 p-12">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          <div className="text-sm text-secondary-wh40k">
            Loading assignment queue...
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-400" />
        <div className="text-sm text-red-400">{error}</div>
        <button
          onClick={onRefresh}
          className="mt-3 rounded-md bg-red-500/20 px-4 py-1.5 text-xs text-red-300 hover:bg-red-500/30"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-(--card-border) bg-card/40 p-8">
        <EmptyState
          icon={Users}
          title="Queue not loaded yet"
          action={
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-md bg-amber-500/20 px-4 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Load Queue
            </button>
          }
        >
          The assignment queue is computed automatically. Load it to see who the
          solver plans for each boss, then use Refresh to pull the latest.
        </EmptyState>
      </div>
    )
  }

  // Nothing to plan: explain instead of an empty summary.
  if (sequence.length === 0) {
    return (
      <div className="rounded-lg border border-(--card-border) bg-card/40 p-8">
        <EmptyState
          icon={Users}
          title="No active raid this season"
          action={
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-md bg-(--card-bg) px-3 py-1.5 text-xs text-secondary-wh40k hover:text-primary-wh40k"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          }
        >
          Every stage is cleared or skipped, so there is nothing to assign right
          now. New targets on the Targets tab will repopulate the queue.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-(--card-border) bg-card/40 px-4 py-3">
        {metrics && (
          <div className="text-xs">
            <span className="text-secondary-wh40k">Tokens Planned: </span>
            <span className="font-semibold text-primary-wh40k">
              {metrics.totalTokensPlanned}
            </span>
          </div>
        )}
        {isStale && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Queue may be stale
          </div>
        )}
        <button
          onClick={onRefresh}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-(--card-bg) px-3 py-1 text-xs text-secondary-wh40k hover:text-primary-wh40k"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Stage pipeline */}
      {sequence.length > 0 && (
        <div className="overflow-x-auto pb-2">
          <div className="flex items-center gap-3">
            {sequence.map((stage, idx) => (
              <div
                key={`${stage.stageCode}-${stage.loopIndex}`}
                className="flex shrink-0 items-center gap-3"
              >
                {idx > 0 && (
                  <span className="text-sm font-medium text-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)]">
                    &rarr;
                  </span>
                )}
                <StageBadge
                  stage={stage}
                  isActive={idx === activeStageIndex}
                  onClick={() => setActiveStageIndex(idx)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* One card per future stage; the current stage is in the top card. */}
      <div className="space-y-3">
        {visibleStages.map((stage, idx) => {
          const sa = stageAssignments.find(
            (a) =>
              a.stageCode === stage.stageCode && a.loopIndex === stage.loopIndex
          )
          return (
            <StageDetailCard
              key={`${stage.stageCode}-${stage.loopIndex}`}
              stage={stage}
              assignments={sa}
              playerBudgets={playerBudgets}
              defaultOpen={idx === 0 || idx === 1 || stage.isCurrentStage}
              avatarMap={resolvedAvatarMap}
              guildCode={resolvedGuildCode}
              tokenPerformance={resolvedTokenPerformance}
              performanceData={resolvedPerformanceData}
            />
          )
        })}
      </div>
    </div>
  )
}
